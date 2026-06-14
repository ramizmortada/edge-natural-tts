// Quick test: does edge-tts-universal work at all from Node.js on this machine?
const { Communicate } = require("edge-tts-universal");

async function test() {
  console.log("Connecting to Edge TTS via Node.js...");
  const start = Date.now();
  
  try {
    const comm = new Communicate("Hello world, this is a test.", {
      voice: "en-US-AriaNeural",
    });
    
    let audioBytes = 0;
    let wordEvents = 0;
    
    for await (const chunk of comm.stream()) {
      if (chunk.type === "audio" && chunk.data) {
        audioBytes += chunk.data.length;
      } else if (chunk.type === "WordBoundary") {
        wordEvents++;
      }
    }
    
    console.log(`SUCCESS in ${Date.now() - start}ms`);
    console.log(`  Audio bytes: ${audioBytes}`);
    console.log(`  Word events: ${wordEvents}`);
  } catch (err) {
    console.error(`FAILED in ${Date.now() - start}ms`);
    console.error(`  Error: ${err.message}`);
  }
}

test();
