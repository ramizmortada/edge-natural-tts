const { Communicate } = require('edge-tts-universal');

// Native messaging requires reading exactly the specified number of bytes
let buffer = Buffer.alloc(0);

process.stdin.on('readable', () => {
  let chunk;
  while ((chunk = process.stdin.read()) !== null) {
    buffer = Buffer.concat([buffer, chunk]);
    processBuffer();
  }
});

function processBuffer() {
  while (buffer.length >= 4) {
    const msgLength = buffer.readUInt32LE(0);
    
    if (buffer.length >= 4 + msgLength) {
      const msgBuffer = buffer.subarray(4, 4 + msgLength);
      buffer = buffer.subarray(4 + msgLength); // Keep the rest
      
      const msgStr = msgBuffer.toString('utf8');
      try {
        const msg = JSON.parse(msgStr);
        handleMessage(msg);
      } catch (err) {
        sendMessage({ type: "error", error: "Failed to parse JSON" });
      }
    } else {
      break; // Wait for more data
    }
  }
}

function sendMessage(msg) {
  try {
    const msgStr = JSON.stringify(msg);
    const msgBuffer = Buffer.from(msgStr, 'utf8');
    
    const header = Buffer.alloc(4);
    header.writeUInt32LE(msgBuffer.length, 0);
    
    process.stdout.write(header);
    process.stdout.write(msgBuffer);
  } catch (err) {
    // Cannot log normally, ignore or write to a debug file
  }
}

async function handleMessage(msg) {
  if (msg.type === "START") {
    const { text, voice, rateString } = msg;
    
    try {
      const communicate = new Communicate(text, {
        voice,
        rate: rateString
      });
      
      let audioBuffer = Buffer.alloc(0);

      for await (const chunk of communicate.stream()) {
        if (chunk.type === "audio" && chunk.data) {
          audioBuffer = Buffer.concat([audioBuffer, Buffer.from(chunk.data)]);
          if (audioBuffer.length >= 8192) {
            sendMessage({
              type: "audio",
              data: audioBuffer.toString('base64')
            });
            audioBuffer = Buffer.alloc(0);
          }
        } else if (chunk.type === "WordBoundary") {
          sendMessage({
            type: "WordBoundary",
            offset: chunk.offset,
            duration: chunk.duration,
            textObj: chunk.text
          });
        }
      }

      if (audioBuffer.length > 0) {
        sendMessage({
          type: "audio",
          data: audioBuffer.toString('base64')
        });
      }
      
      sendMessage({ type: "end" });
      
    } catch (error) {
      sendMessage({ type: "error", error: error.message || error.toString() });
    }
  }
}
