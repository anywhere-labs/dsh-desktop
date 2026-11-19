// Loaded with --import into the launcher's Node.js: once the launcher is connected, a promise rejects with
// no handler attached, as meshcall 0.3.0 can report a call that failed while it was still being opened (#1574).
setTimeout(() => { void Promise.reject(new Error('late meshcall call rejection')) }, 300)
