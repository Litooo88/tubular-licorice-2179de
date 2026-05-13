import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("Missing OPENAI_API_KEY.");
  process.exit(1);
}

const outputDir = fileURLToPath(new URL("../dist/prompts/", import.meta.url));
await mkdir(outputDir, { recursive: true });

const prompts = [
  {
    file: "welcome.mp3",
    input: "Du hör en automatisk röst från Nordic E-Mobility. Välkommen. Tryck 1 för verkstad, service och bokning. Tryck 2 för ny elscooter, försäljning eller inbyte. Vi kopplar dig direkt."
  },
  {
    file: "voicemail-prompt.mp3",
    input: "Du hör en automatisk röst från Nordic E-Mobility. Du har kommit till vår röstbrevlåda. Lämna ditt namn, telefonnummer och vad det gäller efter pipet. Genom att lämna ett meddelande godkänner du att samtalet spelas in och lagras i 90 dagar för att vi ska kunna återkomma. Tryck fyrkant när du är klar."
  },
  {
    file: "outside-hours-prompt.mp3",
    input: "Du hör en automatisk röst från Nordic E-Mobility. Du har ringt utanför våra öppettider måndag till fredag 9 till 18. Lämna ett meddelande efter pipet så hör vi av oss på morgonen."
  },
  {
    file: "hold-music.mp3",
    input: "Ett ögonblick, vi kopplar dig vidare."
  }
];

for (const prompt of prompts) {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: process.env.OPENAI_TTS_VOICE || "coral",
      input: prompt.input,
      instructions: "Speak Swedish clearly in a calm, professional workshop receptionist tone. Keep a friendly but concise pace.",
      response_format: "mp3"
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to generate ${prompt.file}: ${response.status} ${await response.text()}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(join(outputDir, prompt.file), bytes);
  console.log(`Generated ${prompt.file}`);
}
