chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "tts-stream") return;

  let nativePort: chrome.runtime.Port | null = null;
  let isActive = true;

  port.onDisconnect.addListener(() => {
    isActive = false;
    if (nativePort) {
      nativePort.disconnect();
      nativePort = null;
    }
  });

  port.onMessage.addListener((msg) => {
    if (msg.type === "START") {
      try {
        // Connect to the native messaging host
        nativePort = chrome.runtime.connectNative("com.edgetts.host");
        
        nativePort.onDisconnect.addListener(() => {
          if (chrome.runtime.lastError) {
            console.error("Native host disconnected:", chrome.runtime.lastError);
            if (isActive) {
              port.postMessage({ type: "error", error: "Native host disconnected. Did you run install.bat and set the correct extension ID?" });
            }
          }
        });

        nativePort.onMessage.addListener((nativeMsg) => {
          if (!isActive) return;

          if (nativeMsg.type === "audio") {
             // Array needs to be casted to Uint8Array when creating chunks in content script,
             // so sending an Array is fine.
             port.postMessage({
               type: "audio",
               data: nativeMsg.data
             });
          } else if (nativeMsg.type === "WordBoundary") {
             port.postMessage({
               type: "WordBoundary",
               offset: nativeMsg.offset,
               duration: nativeMsg.duration,
               textObj: nativeMsg.textObj
             });
          } else if (nativeMsg.type === "end") {
             port.postMessage({ type: "end" });
             nativePort?.disconnect();
          } else if (nativeMsg.type === "error") {
             port.postMessage({ type: "error", error: nativeMsg.error });
             nativePort?.disconnect();
          }
        });

        // Forward the START message to the native host
        nativePort.postMessage({
          type: "START",
          text: msg.text,
          voice: msg.voice,
          rateString: msg.rateString
        });
        
      } catch (error: any) {
        if (isActive) {
          port.postMessage({ type: "error", error: error.message || error.toString() });
        }
      }
    }
  });
});
