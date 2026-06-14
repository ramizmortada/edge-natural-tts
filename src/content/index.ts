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
`;
document.head.appendChild(style);

const VALID_TAGS = new Set(["P", "LI", "BLOCKQUOTE", "SPAN", "A", "TD", "TH", "ARTICLE"]);

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
  if (text.trim().length < 15) return false;
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

function clearHighlight() {
  if ('highlights' in CSS) {
    (CSS as any).highlights.delete(activeHighlightName);
  }
}

document.addEventListener("mousemove", (e) => {
  if (isPlaying || isLoading) return;

  const target = e.target as HTMLElement;
  
  if (target === playButton || playButton.contains(target)) {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    return;
  }

  const validEl = getClosestValidElement(target);

  if (validEl) {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
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
      }
    }
    
    playButton.style.opacity = "1";
    playButton.style.pointerEvents = "auto";
  } else {
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

playButton.onclick = async (e) => {
  e.stopPropagation();
  e.preventDefault();

  if (isPlaying && audioRef) {
    audioRef.pause();
    isPlaying = false;
    clearHighlight();
    playButton.innerHTML = PLAY_SVG;
    playButton.style.background = "#2563eb";
    
    setTimeout(() => {
      if (!playButton.matches(":hover")) {
        playButton.style.opacity = "0";
        playButton.style.pointerEvents = "none";
        currentTarget = null;
      }
    }, 100);
    return;
  }

  if (isLoading || !currentTarget) return;

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

  const fullTextToRead = extractRawText(currentTarget);
  if (!fullTextToRead || !fullTextToRead.trim()) return;

  isLoading = true;
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
      const wordBoundaries: any[] = [];
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
      });

      audioRef.onended = () => {
        isPlaying = false;
        clearHighlight();
        playButton.innerHTML = PLAY_SVG;
        playButton.style.background = "#2563eb";
        
        if (!playButton.matches(":hover")) {
          playButton.style.opacity = "0";
          playButton.style.pointerEvents = "none";
          currentTarget = null;
        }
      };

      let lastHighlightedWord: any = null;

      const highlightTick = setInterval(() => {
        if (!isPlaying || !audioRef) return;
        const currentTimeMs = audioRef.currentTime * 1000;
        
        const currentWord = wordBoundaries.find(w => 
          currentTimeMs >= w.audioOffsetMs && 
          currentTimeMs <= (w.audioOffsetMs + w.durationMs)
        );

        if (currentWord && currentTarget && 'highlights' in CSS) {
          if (currentWord !== lastHighlightedWord) {
            lastHighlightedWord = currentWord;
            const range = createRangeFromOffset(currentTarget, currentWord.charOffset, currentWord.charLength);
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

function base64ToUint8Array(base64: string) {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes;
}

      // Open connection to background script to bypass CSP
      const port = chrome.runtime.connect({ name: "tts-stream" });
      
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
                 wordBoundaries.push({ audioOffsetMs, durationMs, charOffset, charLength });
               }
             }
          }
        } else if (msg.type === "end") {
          if (mediaSource && mediaSource.readyState === 'open') {
            mediaSource.endOfStream();
          }
        } else if (msg.type === "error") {
          console.error("Stream error from background:", msg.error);
        }
      });

      port.onDisconnect.addListener(() => {
        clearInterval(highlightTick);
      });

      port.postMessage({
        type: "START",
        text: fullTextToRead,
        voice,
        rateString
      });

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
