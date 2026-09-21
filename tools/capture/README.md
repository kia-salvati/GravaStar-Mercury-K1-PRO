# Capture harness

Records the vendor app's HID traffic so our encoder can be verified against the bytes their app
actually sends. `MockTransport` replays these captures, and it rejects any frame that does not
appear in one — which is how spec safety rule 1 ("never send an unobserved frame") is enforced as a
test failure rather than a convention.

## Running a session

1. Open <https://support.gravastar.com/1khub/> in Chrome and connect the keyboard.
2. DevTools → Console, paste the whole of `record.js`, press Enter.
3. Label each action **before** performing it:

   ```js
   __k916.mark('read-keymap-default')
   ```

4. Perform the action in their UI.
5. When finished, either download the file:

   ```js
   __k916.save('session-1')
   ```

   or read it back as a string (no download needed — this is what a browser driver uses):

   ```js
   __k916.dump()
   ```

6. Put the result in `packages/protocol/test/fixtures/session-1.jsonl`.

## Labels to capture

| Label | Action |
|---|---|
| `connect` | Connect the keyboard |
| `read-keymap-default` | Basic Key Remapping, Default layer |
| `read-keymap-fn` | Switch to Fn Layer |
| `read-keymap-fn1` | Switch to Fn1 Layer |
| `read-lighting` | Open RGB Lighting |
| `read-macros` | Open Macro Configuration |
| `read-overview` | Open Device Overview |
| `battery-wired` | Idle 30s on a cabled connection |
| `battery-dongle` | Idle 30s on the 2.4G dongle |

For deriving byte offsets, change **one** setting per capture — see the derivation steps in
`docs/superpowers/plans/2026-09-10-k916-protocol-reads.md`, Tasks 12 and 13. Two changes in one
capture make the diff ambiguous.

## Event format

Newline-delimited JSON, one object per line:

```json
{"t":1789062297,"dir":"out:feature","reportId":6,"bytes":"87 00 00 01 00 02","label":"connect"}
```

`dir` is one of `out:feature`, `out:output`, `in:feature`, `in:input`.

## Safety

This harness only observes. It wraps the HID methods and passes every call through untouched — it
never sends a frame of its own, and it is never loaded by our own app.
