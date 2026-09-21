// Paste into the DevTools console on https://support.gravastar.com/1khub/ .
// Records every HID frame exchanged with the keyboard.
// Label actions with  __k916.mark('read-keymap')  and finish with  __k916.save()
// or  __k916.dump()  to get the events back as a string without downloading.
;(() => {
  if (globalThis.__k916) {
    console.warn('[k916] already recording')
    return
  }

  const events = []

  const hex = (view) => {
    const bytes =
      view instanceof DataView
        ? new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
        : new Uint8Array(view)
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ')
  }

  const record = (dir, reportId, data) => {
    events.push({ t: Date.now(), dir, reportId, bytes: hex(data), label: globalThis.__k916.label })
  }

  const proto = HIDDevice.prototype
  const origSendFeature = proto.sendFeatureReport
  const origRecvFeature = proto.receiveFeatureReport
  const origSendOutput = proto.sendReport

  proto.sendFeatureReport = function (reportId, data) {
    record('out:feature', reportId, data)
    return origSendFeature.call(this, reportId, data)
  }

  proto.sendReport = function (reportId, data) {
    record('out:output', reportId, data)
    return origSendOutput.call(this, reportId, data)
  }

  proto.receiveFeatureReport = async function (reportId) {
    const result = await origRecvFeature.call(this, reportId)
    record('in:feature', reportId, result)
    return result
  }

  // Their code assigns device.oninputreport = handler, so wrap the setter to see input reports.
  const desc = Object.getOwnPropertyDescriptor(proto, 'oninputreport')
  Object.defineProperty(proto, 'oninputreport', {
    configurable: true,
    get() {
      return desc.get.call(this)
    },
    set(handler) {
      desc.set.call(this, function (event) {
        record('in:input', event.reportId, event.data)
        return handler.apply(this, arguments)
      })
    },
  })

  // addEventListener('inputreport') is the other way a page can subscribe; cover it too.
  const origAddEventListener = proto.addEventListener
  proto.addEventListener = function (type, listener, options) {
    if (type !== 'inputreport') return origAddEventListener.call(this, type, listener, options)
    const wrapped = (event) => {
      record('in:input', event.reportId, event.data)
      return typeof listener === 'function' ? listener(event) : listener.handleEvent(event)
    }
    return origAddEventListener.call(this, type, wrapped, options)
  }

  globalThis.__k916 = {
    label: 'unlabelled',

    mark(label) {
      this.label = label
      console.log('[k916] now labelling:', label)
      return label
    },

    get count() {
      return events.length
    },

    /** Newline-delimited JSON. Returned directly so a driver can read it without a download. */
    dump() {
      return events.map((e) => JSON.stringify(e)).join('\n')
    },

    /** Everything captured since the last clear, then forget it. Useful between labelled steps. */
    drain() {
      const body = this.dump()
      events.length = 0
      return body
    },

    save(name = 'capture') {
      const url = URL.createObjectURL(new Blob([this.dump()], { type: 'application/x-ndjson' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${name}.jsonl`
      a.click()
      URL.revokeObjectURL(url)
      console.log(`[k916] saved ${events.length} events`)
    },
  }

  console.log('[k916] recording. __k916.mark("label") before each action, __k916.dump() when done.')
})()
