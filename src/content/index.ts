import { Communicate } from "edge-tts-universal/browser";

let isPlaying = false;
let isLoading = false;
let audioRef: HTMLAudioElement | null = null;
let currentTarget: HTMLElement | null = null;
let hoverTimer: any = null;
let syncInterval: any = null;
let mediaSource: MediaSource | null = null;
let sourceBuffer: SourceBuffer | null = null;
let activeHighlightName = "edge-tts-highlight";
let currentTextNode: Node | null = null;

// Inject highlight styles
const style = document.createElement("style");
style.textContent = `
  ::highlight(${activeHighlightName}) {
    background-color: rgba(59, 130, 246, 0.4);
    color: inherit;
    border-radius: 3px;
  }
  ::highlight(aura-sentence-hover) {
    background-color: rgba(250, 204, 21, 0.4);
    cursor: pointer;
  }
`;
document.head.appendChild(style);

const VALID_TAGS = new Set(["P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "SPAN", "A", "TD", "TH", "ARTICLE", "DIV"]);

function isValidTextElement(el: HTMLElement): boolean {
  if (!el || !el.tagName) return false;
  if (!VALID_TAGS.has(el.tagName)) return false;
  
  if (el.tagName === "DIV") {
    const hasBlockChildren = Array.from(el.children).some(child => {
      const tag = child.tagName;
      return ["DIV", "P", "UL", "OL", "TABLE", "SECTION", "ARTICLE", "HEADER", "FOOTER", "BLOCKQUOTE"].includes(tag);
    });
    if (hasBlockChildren) return false;
  }

  const text = el.innerText || el.textContent || "";
  if (text.trim().length === 0) return false;
  const rect = el.getBoundingClientRect();
  if (rect.height > 600) return false;
  return true;
}

function getClosestValidElement(el: HTMLElement | null): HTMLElement | null {
  let current = el;
  let highestValid: HTMLElement | null = null;
  while (current && current !== document.body && current !== document.documentElement) {
    if (isValidTextElement(current)) {
      highestValid = current;
    } else if (highestValid) {
      break;
    }
    current = current.parentElement;
  }
  return highestValid;
}

function getNextValidElement(current: HTMLElement): HTMLElement | null {
  let node: Node | null = current;
  function getNextNode(n: Node): Node | null {
    if (n !== current && n.firstChild) return n.firstChild;
    while (n) {
      if (n.nextSibling) return n.nextSibling;
      n = n.parentNode as Node;
    }
    return null;
  }

  while ((node = getNextNode(node))) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (isValidTextElement(el)) {
        return el;
      }
    }
  }
  return null;
}

function extractRawText(el: HTMLElement): string {
  let text = "";
  function traverse(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || "";
    } else {
      for (const child of Array.from(node.childNodes)) {
        traverse(child);
      }
    }
  }
  traverse(el);
  return text;
}

function createRangeFromOffset(el: HTMLElement, start: number, length: number): Range | null {
  const range = document.createRange();
  let currentOffset = 0;
  let startNode: Node | null = null;
  let startNodeOffset = 0;
  let endNode: Node | null = null;
  let endNodeOffset = 0;

  function traverse(node: Node) {
    if (endNode) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const nodeLen = node.textContent?.length || 0;
      if (!startNode && currentOffset + nodeLen > start) {
        startNode = node;
        startNodeOffset = start - currentOffset;
      }
      if (startNode && currentOffset + nodeLen >= start + length) {
        endNode = node;
        endNodeOffset = start + length - currentOffset;
      }
      currentOffset += nodeLen;
    } else {
      for (const child of Array.from(node.childNodes)) {
        traverse(child);
      }
    }
  }

  traverse(el);

  if (startNode && endNode) {
    try {
      range.setStart(startNode, startNodeOffset);
      range.setEnd(endNode, endNodeOffset);
      return range;
    } catch (e) {
      return null;
    }
  }
  return null;
}

const PLAY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
const PAUSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
const LOAD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>`;

const playButton = document.createElement("button");
playButton.id = "edge-tts-hover-play";
playButton.innerHTML = PLAY_SVG;
playButton.style.position = "absolute";
playButton.style.zIndex = "2147483647"; 
playButton.style.background = "#2563eb";
playButton.style.color = "white";
playButton.style.border = "none";
playButton.style.borderRadius = "50%";
playButton.style.width = "20px";
playButton.style.height = "20px";
playButton.style.display = "flex";
playButton.style.alignItems = "center";
playButton.style.justifyContent = "center";
playButton.style.cursor = "pointer";
playButton.style.boxShadow = "0 4px 12px rgba(37, 99, 235, 0.4)";
playButton.style.opacity = "0";
playButton.style.pointerEvents = "none";
  playButton.style.transition = "opacity 0.15s ease, background 0.2s";

document.body.appendChild(playButton);

const floatingBar = document.createElement("div");
floatingBar.id = "edge-tts-floating-bar";
Object.assign(floatingBar.style, {
  position: "fixed",
  top: "50%",
  right: "20px",
  transform: "translateY(-50%) translateX(100px)",
  backgroundColor: "rgba(15, 23, 42, 0.8)",
  backdropFilter: "blur(8px)",
  border: "1px solid rgba(255, 255, 255, 0.1)",
  borderRadius: "12px",
  padding: "8px",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  zIndex: "2147483647",
  transition: "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s",
  opacity: "0",
  pointerEvents: "none",
  boxShadow: "0 10px 25px rgba(0, 0, 0, 0.3)"
});

const stopButton = document.createElement("button");
stopButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" ry="2"></rect></svg>`;
Object.assign(stopButton.style, {
  width: "36px",
  height: "36px",
  borderRadius: "8px",
  border: "none",
  backgroundColor: "rgba(239, 68, 68, 0.2)",
  color: "#ef4444",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  transition: "background-color 0.2s"
});
stopButton.onmouseenter = () => stopButton.style.backgroundColor = "rgba(239, 68, 68, 0.4)";
stopButton.onmouseleave = () => stopButton.style.backgroundColor = "rgba(239, 68, 68, 0.2)";

stopButton.onclick = () => {
  stopSession();
};

floatingBar.appendChild(stopButton);
document.body.appendChild(floatingBar);

function stopSession() {
  if (audioRef) {
     audioRef.pause();
  }
  isPlaying = false;
  isLoading = false;
  activeTarget = null;
  clearHighlight(true);
  clearSentenceHover();
  
  floatingBar.style.transform = "translateY(-50%) translateX(100px)";
  floatingBar.style.opacity = "0";
  floatingBar.style.pointerEvents = "none";
  
  if (currentTarget) {
     updatePlayButtonAppearance();
  } else {
     playButton.style.opacity = "0";
     playButton.style.pointerEvents = "none";
  }
}

function startSession() {
  floatingBar.style.transform = "translateY(-50%) translateX(0)";
  floatingBar.style.opacity = "1";
  floatingBar.style.pointerEvents = "auto";
}

function syncPosition() {
  if (!currentTarget) return;
  
  let rect: DOMRect;
  if (currentTextNode) {
    const range = document.createRange();
    range.selectNodeContents(currentTextNode);
    rect = range.getBoundingClientRect();
  } else {
    rect = currentTarget.getBoundingClientRect();
  }

  const top = rect.top + window.scrollY;
  const left = rect.left + window.scrollX - 24;
  
  playButton.style.top = `${top}px`;
  playButton.style.left = `${left}px`;
}

function updatePlayButtonAppearance() {
  if (isLoading) return;
  if (isPlaying && currentTarget === activeTarget && activeTarget !== null) {
    playButton.innerHTML = PAUSE_SVG;
    playButton.style.background = "#ef4444";
  } else {
    playButton.innerHTML = PLAY_SVG;
    playButton.style.background = "#2563eb";
  }
}

let activeTarget: HTMLElement | null = null;
let currentHighlightTick: any = null;
let activeFullText = "";
let activeWordBoundaries: any[] = [];
let hoveredAudioOffset: number | null = null;
let lastSentenceStart = -1;
const sentenceHighlightName = "aura-sentence-hover";
let hoveredValidEl: HTMLElement | null = null;
let hoveredSentenceStart = 0;
let pendingSeekCharOffset: number | null = null;
function clearHighlight(stopTimer = true) {
  if (stopTimer && currentHighlightTick) {
    clearInterval(currentHighlightTick);
    currentHighlightTick = null;
  }
  if ('highlights' in CSS) {
    (CSS as any).highlights.delete(activeHighlightName);
  }
}

function clearSentenceHover() {
  if ('highlights' in CSS) (CSS as any).highlights.delete(sentenceHighlightName);
  hoveredAudioOffset = null;
  lastSentenceStart = -1;
  if (hoveredValidEl) {
     hoveredValidEl.style.cursor = "";
     hoveredValidEl = null;
  }
}

function handleSentenceHover(e: MouseEvent, validEl: HTMLElement) {
  const range = (document as any).caretRangeFromPoint(e.clientX, e.clientY);
  if (!range) return;

  const textNode = range.startContainer;
  const offsetInNode = range.startOffset;
  if (textNode.nodeType !== Node.TEXT_NODE) return;

  let absoluteOffset = 0;
  let found = false;

  function traverse(node: Node) {
    if (found) return;
    if (node === textNode) {
      absoluteOffset += offsetInNode;
      found = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      absoluteOffset += node.textContent?.length || 0;
    } else {
      for (const child of Array.from(node.childNodes)) {
        traverse(child);
      }
    }
  }
  traverse(validEl);
  if (!found) return;

  const text = (validEl === activeTarget) ? activeFullText : extractRawText(validEl);
  let sentenceStart = 0;
  let sentenceEnd = text.length;

  for (let i = absoluteOffset; i >= 0; i--) {
     if (i === 0) { sentenceStart = 0; break; }
     if ((text[i] === '.' || text[i] === '?' || text[i] === '!') && (text[i+1] === ' ' || text[i+1] === '\n')) {
         sentenceStart = i + 2;
         break;
     }
     if (text[i] === '\n') {
         sentenceStart = i + 1;
         break;
     }
  }

  for (let i = absoluteOffset; i < text.length; i++) {
     if ((text[i] === '.' || text[i] === '?' || text[i] === '!') && (i === text.length - 1 || text[i+1] === ' ' || text[i+1] === '\n')) {
         sentenceEnd = i + 1;
         break;
     }
     if (text[i] === '\n') {
         sentenceEnd = i;
         break;
     }
  }

  if (sentenceStart === lastSentenceStart && hoveredValidEl === validEl) return;
  lastSentenceStart = sentenceStart;
  
  if (hoveredValidEl && hoveredValidEl !== validEl) {
     hoveredValidEl.style.cursor = "";
  }
  hoveredValidEl = validEl;

  if (sentenceEnd > sentenceStart) {
      const highlightRange = createRangeFromOffset(validEl, sentenceStart, sentenceEnd - sentenceStart);
      if (highlightRange && 'highlights' in CSS) {
         const highlight = new (window as any).Highlight(highlightRange);
         (CSS as any).highlights.set(sentenceHighlightName, highlight);
         validEl.style.cursor = "pointer";
      }
      
      hoveredSentenceStart = sentenceStart;
      if (validEl === activeTarget && isPlaying) {
         const firstWord = activeWordBoundaries.find(w => w.charOffset >= sentenceStart);
         if (firstWord) {
            hoveredAudioOffset = firstWord.audioOffsetMs;
         } else {
            hoveredAudioOffset = null;
         }
      } else {
         hoveredAudioOffset = null;
      }
  }
}

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (target === playButton || playButton.contains(target) || floatingBar.contains(target)) return;

  if (hoveredValidEl && activeTarget !== null) {
     e.preventDefault();
     e.stopPropagation();

     if (hoveredValidEl === activeTarget && isPlaying && hoveredAudioOffset !== null && audioRef) {
        audioRef.currentTime = hoveredAudioOffset / 1000;
     } else {
        pendingSeekCharOffset = hoveredSentenceStart;
        currentTarget = hoveredValidEl;
        if (playButton.onclick) {
           playButton.onclick(null as any);
        }
     }
  }
}, true);

document.addEventListener("mousemove", (e) => {
  if (isLoading) return;

  const target = e.target as HTMLElement;
  const validEl = getClosestValidElement(target);
  
  if (target === playButton || playButton.contains(target)) {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    clearSentenceHover();
    return;
  }

  if (validEl) {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    
    if (activeTarget !== null) {
      handleSentenceHover(e, validEl);
    } else {
      clearSentenceHover();
    }
    
    if (currentTarget !== validEl) {
      // Prevent jumping to an ancestor container when traversing padding
      if (currentTarget && validEl.contains(currentTarget)) {
        // Keep current target locked
      } else {
        currentTarget = validEl;
        
        currentTextNode = null;
        const walker = document.createTreeWalker(currentTarget, NodeFilter.SHOW_TEXT, null);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (node.textContent && node.textContent.trim().length > 0) {
            currentTextNode = node;
            break;
          }
        }

        syncPosition();
        
        if (!syncInterval) {
          syncInterval = setInterval(syncPosition, 50); 
        }
        updatePlayButtonAppearance();
      }
    }
    
    playButton.style.opacity = "1";
    playButton.style.pointerEvents = "auto";
  } else {
    clearSentenceHover();
    if (!hoverTimer) {
      hoverTimer = setTimeout(() => {
        if (!isPlaying && !isLoading) {
          playButton.style.opacity = "0";
          playButton.style.pointerEvents = "none";
          currentTarget = null;
          if (syncInterval) {
            clearInterval(syncInterval);
            syncInterval = null;
          }
        }
        hoverTimer = null;
      }, 400); 
    }
  }
});
function base64ToUint8Array(base64: string) {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes;
}

interface PreloadSession {
  text: string;
  port: chrome.runtime.Port;
  chunks: Uint8Array[];
  wordBoundaries: any[];
  isFinished: boolean;
  listener: (msg: any) => void;
  error?: string;
}

let activePreload: PreloadSession | null = null;

function startPreload(text: string, voice: string, rateString: string) {
  if (activePreload && activePreload.text === text) return;
  if (activePreload) {
    activePreload.port.disconnect();
    activePreload = null;
  }
  
  const port = chrome.runtime.connect({ name: "tts-stream" });
  const session: PreloadSession = {
    text, port, chunks: [], wordBoundaries: [], isFinished: false, listener: () => {}
  };
  activePreload = session;
  
  const listener = (msg: any) => {
    if (msg.type === "audio") {
      session.chunks.push(base64ToUint8Array(msg.data));
    } else if (msg.type === "WordBoundary") {
      if (msg.offset !== undefined) {
         const audioOffsetMs = msg.offset / 10000;
         const durationMs = msg.duration / 10000;
         const wordStr = msg.textObj || "";
         if (wordStr.length > 0) {
           session.wordBoundaries.push({ audioOffsetMs, durationMs, wordStr });
         }
      }
    } else if (msg.type === "end") {
      session.isFinished = true;
    } else if (msg.type === "error") {
      session.error = msg.error;
      session.isFinished = true;
    }
  };
  session.listener = listener;
  port.onMessage.addListener(listener);
  port.postMessage({ type: "START", text, voice, rateString });
}

playButton.onclick = async (e: any) => {
  if (e) {
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
  }

  if (isPlaying && audioRef) {
    if (currentTarget === activeTarget) {
      audioRef.pause();
      isPlaying = false;
      clearHighlight(false);
      playButton.innerHTML = PLAY_SVG;
      playButton.style.background = "#2563eb";
      return;
    } else {
      audioRef.pause();
      isPlaying = false;
      clearHighlight(true);
    }
  }

  if (!isPlaying && audioRef && currentTarget === activeTarget && activeTarget !== null) {
    audioRef.play().catch(e => console.error("Resume failed", e));
    isPlaying = true;
    playButton.innerHTML = PAUSE_SVG;
    playButton.style.background = "#ef4444";
    return;
  }

  if (isLoading || !currentTarget) return;

  const fullTextToRead = extractRawText(currentTarget);
  if (!fullTextToRead || !fullTextToRead.trim()) return;

  isLoading = true;
  activeTarget = currentTarget;
  startSession();
  playButton.innerHTML = LOAD_SVG;
  playButton.children[0].animate([{transform: 'rotate(0deg)'}, {transform: 'rotate(360deg)'}], {duration: 1000, iterations: Infinity});
  playButton.style.background = "#475569"; 
  clearHighlight();

  try {
    chrome.storage.local.get(["voice", "rate"], async (result) => {
      const voice = (result.voice as string) || "en-US-AriaNeural";
      const rateArray = (result.rate as number[]) || [0];
      const rateString = rateArray[0] >= 0 ? `+${rateArray[0]}%` : `${rateArray[0]}%`;

      if (!audioRef) {
        audioRef = document.createElement("audio");
        document.body.appendChild(audioRef);
      }

      mediaSource = new MediaSource();
      audioRef.src = URL.createObjectURL(mediaSource);

      audioRef.play().catch(e => console.error("Initial play failed", e));

      let isFirstChunk = true;
      activeWordBoundaries = [];
      activeFullText = fullTextToRead;
      let sourceBuffer: SourceBuffer | null = null;
      const queue: Uint8Array[] = [];
      let lastCharOffset = 0;

      mediaSource.addEventListener('sourceopen', () => {
        if (!mediaSource) return;
        sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
        
        sourceBuffer.addEventListener('updateend', () => {
          if (queue.length > 0 && !sourceBuffer?.updating) {
            sourceBuffer?.appendBuffer(queue.shift()!);
          }
        });

        if (queue.length > 0 && !sourceBuffer.updating) {
          sourceBuffer.appendBuffer(queue.shift()!);
        }
      });

      audioRef.onended = () => {
        isPlaying = false;
        clearHighlight();
        playButton.innerHTML = PLAY_SVG;
        playButton.style.background = "#2563eb";
        
        const nextEl = getNextValidElement(activeTarget!);
        if (nextEl) {
          currentTarget = nextEl;
          currentTextNode = null;
          const walker = document.createTreeWalker(currentTarget, NodeFilter.SHOW_TEXT, null);
          let node: Node | null;
          while ((node = walker.nextNode())) {
            if (node.textContent && node.textContent.trim().length > 0) {
              currentTextNode = node;
              break;
            }
          }
          syncPosition();
          setTimeout(() => {
            if (playButton.onclick) {
              playButton.onclick(null as any);
            }
          }, 100);
        } else {
          stopSession();
        }
      };

      let lastHighlightedWord: any = null;

      if (currentHighlightTick) clearInterval(currentHighlightTick);
      currentHighlightTick = setInterval(() => {
        if (!isPlaying || !audioRef) return;
        const currentTimeMs = audioRef.currentTime * 1000;
        
        const currentWord = activeWordBoundaries.find(w => 
          currentTimeMs >= w.audioOffsetMs && 
          currentTimeMs <= (w.audioOffsetMs + w.durationMs)
        );

        if (currentWord && activeTarget && 'highlights' in CSS) {
          if (currentWord !== lastHighlightedWord) {
            lastHighlightedWord = currentWord;
            const range = createRangeFromOffset(activeTarget, currentWord.charOffset, currentWord.charLength);
            if (range) {
              const highlight = new (window as any).Highlight(range);
              (CSS as any).highlights.set(activeHighlightName, highlight);
            }
          }
        } else if (!currentWord && lastHighlightedWord && 'highlights' in CSS) {
          // Clear highlight if we're between words
          lastHighlightedWord = null;
          (CSS as any).highlights.delete(activeHighlightName);
        }
      }, 50);


      function tryEndStream() {
        if (!mediaSource) return;
        if (mediaSource.readyState === 'open') {
          if (sourceBuffer && sourceBuffer.updating) {
            sourceBuffer.addEventListener('updateend', tryEndStream, { once: true });
          } else if (queue.length > 0) {
            sourceBuffer?.addEventListener('updateend', tryEndStream, { once: true });
          } else {
            try {
              mediaSource.endOfStream();
            } catch (e) {
              console.error("endOfStream error", e);
            }
          }
        } else {
          mediaSource.addEventListener('sourceopen', tryEndStream, { once: true });
        }
      }

      let port: chrome.runtime.Port;
      let preloadedSession = (activePreload && activePreload.text === fullTextToRead) ? activePreload : null;
      
      if (preloadedSession) {
        port = preloadedSession.port;
        port.onMessage.removeListener(preloadedSession.listener);
        
        if (preloadedSession.error) {
          isLoading = false;
          playButton.innerHTML = PLAY_SVG;
          playButton.style.background = "#2563eb";
          console.error("TTS generation failed during preload:", preloadedSession.error);
          return;
        }

        if (preloadedSession.chunks.length > 0) {
          isFirstChunk = false;
          isLoading = false;
          isPlaying = true;
          playButton.innerHTML = PAUSE_SVG;
          playButton.style.background = "#ef4444"; 
        }

        for (const chunk of preloadedSession.chunks) {
          queue.push(chunk);
        }
        for (const wb of preloadedSession.wordBoundaries) {
          const charOffset = fullTextToRead.indexOf(wb.wordStr, lastCharOffset);
          if (charOffset !== -1) {
            const charLength = wb.wordStr.length;
            lastCharOffset = charOffset + charLength;
            activeWordBoundaries.push({ audioOffsetMs: wb.audioOffsetMs, durationMs: wb.durationMs, charOffset, charLength });
            
            if (pendingSeekCharOffset !== null && charOffset >= pendingSeekCharOffset && audioRef) {
               audioRef.currentTime = wb.audioOffsetMs / 1000;
               pendingSeekCharOffset = null;
            }
          }
        }
        
        if (preloadedSession.isFinished) {
          tryEndStream();
        }
        activePreload = null;
      } else {
        port = chrome.runtime.connect({ name: "tts-stream" });
        port.postMessage({
          type: "START",
          text: fullTextToRead,
          voice,
          rateString
        });
      }
      
      port.onMessage.addListener((msg) => {
        if (!isLoading && !isPlaying) {
           port.disconnect();
           return;
        }

        if (msg.type === "audio") {
          const chunkData = base64ToUint8Array(msg.data);
          
          if (isFirstChunk) {
            isFirstChunk = false;
            isLoading = false;
            isPlaying = true;
            playButton.innerHTML = PAUSE_SVG;
            playButton.style.background = "#ef4444"; 
          }
          
          if (sourceBuffer && !sourceBuffer.updating) {
            sourceBuffer.appendBuffer(chunkData);
          } else {
            queue.push(chunkData);
          }
        } else if (msg.type === "WordBoundary") {
          if (msg.offset !== undefined) {
             const audioOffsetMs = msg.offset / 10000;
             const durationMs = msg.duration / 10000;
             const wordStr = msg.textObj || "";
             if (wordStr.length > 0) {
                const charOffset = fullTextToRead.indexOf(wordStr, lastCharOffset);
                if (charOffset !== -1) {
                  const charLength = wordStr.length;
                  lastCharOffset = charOffset + charLength;
                  activeWordBoundaries.push({ audioOffsetMs, durationMs, charOffset, charLength });
                  
                  if (pendingSeekCharOffset !== null && charOffset >= pendingSeekCharOffset && audioRef) {
                     audioRef.currentTime = audioOffsetMs / 1000;
                     pendingSeekCharOffset = null;
                  }
                }
              }
          }
        } else if (msg.type === "end") {
          tryEndStream();
        } else if (msg.type === "error") {
          console.error("Stream error from background:", msg.error);
        }
      });

      port.onDisconnect.addListener(() => {
        if (currentHighlightTick) {
          clearInterval(currentHighlightTick);
          currentHighlightTick = null;
        }
      });

      // Start preloading the next chunk
      const nextEl = getNextValidElement(currentTarget!);
      if (nextEl) {
        const nextText = extractRawText(nextEl);
        if (nextText.trim()) {
           startPreload(nextText, voice, rateString);
        }
      }

    });
  } catch (error) {
    console.error("TTS generation failed:", error);
    isLoading = false;
    playButton.innerHTML = PLAY_SVG;
    setTimeout(() => {
      if (!isPlaying) {
        playButton.style.background = "#2563eb";
      }
    }, 2000);
  }
};
