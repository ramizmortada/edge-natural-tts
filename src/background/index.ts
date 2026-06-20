let creatingOffscreen: Promise<void> | null = null;

async function setupOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: "To play text-to-speech audio streams."
  });
  await creatingOffscreen;
  creatingOffscreen = null;
}

let activeClientPort: chrome.runtime.Port | null = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "PLAYBACK_ENDED" || msg.type === "TIME_UPDATE") {
    if (activeClientPort) {
      try {
        activeClientPort.postMessage(msg);
      } catch (e) {
      }
    }
  }
});

interface PreloadedSession {
  text: string;
  audioChunks: string[];
  wordBoundaries: any[];
  isFinished: boolean;
  error: string | null;
  nativePort: chrome.runtime.Port | null;
  isActive: boolean;
}

const preloadCache = new Map<string, PreloadedSession>();

function cleanPreloadCache() {
  if (preloadCache.size > 10) {
    const firstKey = preloadCache.keys().next().value;
    const session = preloadCache.get(firstKey);
    if (session?.nativePort) session.nativePort.disconnect();
    preloadCache.delete(firstKey);
  }
}

function startNativeSession(text: string, voice: string, rateString: string): PreloadedSession {
  if (preloadCache.has(text)) {
    const cached = preloadCache.get(text)!;
    if (cached.error) {
      preloadCache.delete(text); // Retry if the preloaded session errored out
    } else {
      return cached;
    }
  }
  cleanPreloadCache();

  const session: PreloadedSession = {
    text, audioChunks: [], wordBoundaries: [], isFinished: false, error: null, nativePort: null, isActive: false
  };
  preloadCache.set(text, session);

  try {
    const nativePort = chrome.runtime.connectNative("com.edgetts.host");
    session.nativePort = nativePort;

    nativePort.onDisconnect.addListener(() => {
      if (!session.isFinished) {
         session.error = chrome.runtime.lastError ? chrome.runtime.lastError.message! : "Native host disconnected unexpectedly.";
         if (session.isActive && activeClientPort) {
           activeClientPort.postMessage({ type: "error", error: session.error });
         }
      }
    });

    nativePort.onMessage.addListener((nativeMsg) => {
      if (nativeMsg.type === "audio") {
        session.audioChunks.push(nativeMsg.data);
        if (session.isActive) {
          chrome.runtime.sendMessage({ target: "offscreen", type: "APPEND_AUDIO", data: nativeMsg.data }).catch(()=>{});
        }
      } else if (nativeMsg.type === "WordBoundary") {
        const wb = { type: "WordBoundary", offset: nativeMsg.offset, duration: nativeMsg.duration, textObj: nativeMsg.textObj };
        session.wordBoundaries.push(wb);
        if (session.isActive && activeClientPort) {
          activeClientPort.postMessage(wb);
        }
      } else if (nativeMsg.type === "end") {
        session.isFinished = true;
        session.nativePort?.disconnect();
        session.nativePort = null;
        if (session.isActive) {
          if (activeClientPort) activeClientPort.postMessage({ type: "end" });
          chrome.runtime.sendMessage({ target: "offscreen", type: "END_STREAM" }).catch(()=>{});
        }
      } else if (nativeMsg.type === "error") {
        session.error = nativeMsg.error;
        session.nativePort?.disconnect();
        session.nativePort = null;
        if (session.isActive) {
          if (activeClientPort) activeClientPort.postMessage({ type: "error", error: session.error });
          chrome.runtime.sendMessage({ target: "offscreen", type: "STOP" }).catch(()=>{});
        }
      }
    });

    nativePort.postMessage({ type: "START", text, voice, rateString });
  } catch (e: any) {
    session.error = e.message || e.toString();
  }

  return session;
}

const preloadQueue: {text: string, voice: string, rateString: string}[] = [];
let isPreloading = false;

async function processPreloadQueue() {
  if (isPreloading) return;
  isPreloading = true;
  while (preloadQueue.length > 0) {
    const item = preloadQueue.shift()!;
    if (preloadCache.has(item.text)) continue;

    const session = startNativeSession(item.text, item.voice, item.rateString);
    if (!session.isFinished && !session.error) {
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (session.isFinished || session.error) {
            clearInterval(check);
            resolve();
          }
        }, 100);
      });
    }
  }
  isPreloading = false;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "tts-stream") return;

  let isSessionPort = false;

  port.onDisconnect.addListener(() => {
    if (activeClientPort === port) {
      activeClientPort = null;
    }
    if (isSessionPort) {
      chrome.runtime.sendMessage({ target: "offscreen", type: "STOP" }).catch(()=>{});
    }
  });

  port.onMessage.addListener(async (msg) => {
    if (msg.type === "PRELOAD") {
      preloadQueue.push({ text: msg.text, voice: msg.voice, rateString: msg.rateString });
      processPreloadQueue();
    } else if (msg.type === "START") {
      isSessionPort = true;
      activeClientPort = port;

      try {
        await setupOffscreenDocument();
        chrome.runtime.sendMessage({ target: "offscreen", type: "INIT_AUDIO" }).catch(()=>{});

        // Deactivate all current sessions
        for (const s of preloadCache.values()) {
          s.isActive = false;
        }

        const session = startNativeSession(msg.text, msg.voice, msg.rateString);
        session.isActive = true;

        if (session.error) {
          port.postMessage({ type: "error", error: session.error });
          return;
        }

        // Catch up offscreen with already downloaded chunks
        if (session.audioChunks.length > 0) {
          chrome.runtime.sendMessage({ target: "offscreen", type: "APPEND_AUDIO_ARRAY", data: session.audioChunks }).catch(()=>{});
        }
        if (session.wordBoundaries.length > 0) {
          port.postMessage({ type: "WordBoundaryArray", data: session.wordBoundaries });
        }

        if (session.isFinished) {
          port.postMessage({ type: "end" });
          chrome.runtime.sendMessage({ target: "offscreen", type: "END_STREAM" }).catch(()=>{});
        }

      } catch (error: any) {
        port.postMessage({ type: "error", error: error.message || error.toString() });
      }
    } else if (msg.type === "PLAY") {
      chrome.runtime.sendMessage({ target: "offscreen", type: "PLAY" }).catch(()=>{});
    } else if (msg.type === "PAUSE") {
      chrome.runtime.sendMessage({ target: "offscreen", type: "PAUSE" }).catch(()=>{});
    } else if (msg.type === "STOP") {
      chrome.runtime.sendMessage({ target: "offscreen", type: "STOP" }).catch(()=>{});
    } else if (msg.type === "SEEK") {
      chrome.runtime.sendMessage({ target: "offscreen", type: "SEEK", offset: msg.offset }).catch(()=>{});
    }
  });
});
