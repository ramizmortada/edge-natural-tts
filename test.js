import { Communicate } from "edge-tts-universal";

async function run() {
  console.log("Starting...");
  const communicate = new Communicate("Hello world", {
    voice: "en-US-AriaNeural"
  });

  try {
    for await (const chunk of communicate.stream()) {
      if (chunk.type === "audio") {
        console.log("Received audio chunk:", chunk.data.length);
      } else if (chunk.type === "WordBoundary") {
        console.log("Word boundary:", chunk);
      }
    }
    console.log("Done");
  } catch (e) {
    console.error("Error:", e);
  }
}

run();
