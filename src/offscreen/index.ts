function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

let audioRef: HTMLAudioElement | null = null;
let mediaSource: MediaSource | null = null;
let sourceBuffer: SourceBuffer | null = null;
let queue: Uint8Array[] = [];
let isFirstAppend = true;
let timeUpdateInterval: any = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== "offscreen") return;

  switch (msg.type) {
    case "INIT_AUDIO":
      if (audioRef) {
        audioRef.pause();
        audioRef.removeAttribute("src");
        audioRef.load();
      }
      
      queue = [];
      isFirstAppend = true;
      sourceBuffer = null;
      audioRef = new Audio();
      mediaSource = new MediaSource();
      audioRef.src = URL.createObjectURL(mediaSource);
      
      mediaSource.addEventListener("sourceopen", () => {
        if (!mediaSource) return;
        sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
        
        sourceBuffer.addEventListener("updateend", () => {
          if (isFirstAppend) {
            isFirstAppend = false;
            audioRef?.play().catch(e => console.error("Offscreen play failed:", e));
          }
          if (queue.length > 0 && !sourceBuffer?.updating) {
            sourceBuffer?.appendBuffer(queue.shift()!);
          }
        });
        
        if (queue.length > 0 && !sourceBuffer.updating) {
          sourceBuffer.appendBuffer(queue.shift()!);
        }
      });
      
      audioRef.onended = () => {
        chrome.runtime.sendMessage({ type: "PLAYBACK_ENDED" });
      };
      
      if (timeUpdateInterval) clearInterval(timeUpdateInterval);
      timeUpdateInterval = setInterval(() => {
        if (audioRef && !audioRef.paused) {
          chrome.runtime.sendMessage({ type: "TIME_UPDATE", currentTime: audioRef.currentTime });
        }
      }, 50);
      break;

    case "APPEND_AUDIO":
      const chunkData = base64ToUint8Array(msg.data);
      if (sourceBuffer && !sourceBuffer.updating) {
        sourceBuffer.appendBuffer(chunkData);
      } else {
        queue.push(chunkData);
      }
      break;

    case "APPEND_AUDIO_ARRAY":
      for (const b64 of msg.data) {
        queue.push(base64ToUint8Array(b64));
      }
      if (sourceBuffer && !sourceBuffer.updating && queue.length > 0) {
        sourceBuffer.appendBuffer(queue.shift()!);
      }
      break;

    case "END_STREAM":
      if (!mediaSource) break;
      function tryEnd() {
        if (!mediaSource) return;
        if (mediaSource.readyState === 'open') {
          if (sourceBuffer && sourceBuffer.updating) {
            sourceBuffer.addEventListener('updateend', tryEnd, { once: true });
          } else if (queue.length > 0) {
            if (sourceBuffer) {
              sourceBuffer.addEventListener('updateend', tryEnd, { once: true });
            } else {
              // Wait for sourceBuffer to be created by the sourceopen listener
              setTimeout(tryEnd, 50);
            }
          } else {
            try { mediaSource.endOfStream(); } catch(e) {}
          }
        } else if (mediaSource.readyState === 'closed') {
          mediaSource.addEventListener('sourceopen', tryEnd, { once: true });
        }
      }
      tryEnd();
      break;

    case "PLAY":
      audioRef?.play().catch(e => console.error(e));
      break;

    case "PAUSE":
      audioRef?.pause();
      break;

    case "SEEK":
      if (audioRef && msg.offset !== undefined) {
        audioRef.currentTime = msg.offset;
      }
      break;

    case "STOP":
      if (audioRef) {
        audioRef.pause();
        audioRef.removeAttribute("src");
        audioRef.load();
        audioRef = null;
      }
      if (timeUpdateInterval) clearInterval(timeUpdateInterval);
      break;
  }
});
