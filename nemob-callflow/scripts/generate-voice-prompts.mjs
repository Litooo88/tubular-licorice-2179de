import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("Missing ELEVENLABS_API_KEY.");
  process.exit(1);
}

const voiceId = process.env.ELEVENLABS_VOICE_ID || "pNInz6obpgDQGcFmaJgB";
const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const outputDir = fileURLToPath(new URL("../../audio/", import.meta.url));
await mkdir(outputDir, { recursive: true });

const prompts = [
  {
    file: "welcome.mp3",
    text: [
      "Du hör en automatisk röst från Nordic E-Mobility.",
      "",
      "Välkommen.",
      "",
      "Tryck 1 för verkstad, service och bokning.",
      "Tryck 2 för ny elscooter, försäljning eller inbyte.",
      "",
      "Vi kopplar dig direkt."
    ].join("\n")
  },
  {
    file: "voicemail-prompt.mp3",
    text: [
      "Du hör en automatisk röst från Nordic E-Mobility.",
      "",
      "Du har kommit till vår röstbrevlåda.",
      "Lämna ditt namn, telefonnummer och vad det gäller efter pipet.",
      "",
      "Genom att lämna ett meddelande godkänner du att samtalet spelas in och lagras i 90 dagar för att vi ska kunna återkomma.",
      "",
      "Tryck fyrkant när du är klar."
    ].join("\n")
  },
  {
    file: "outside-hours-prompt.mp3",
    text: [
      "Du hör en automatisk röst från Nordic E-Mobility.",
      "",
      "Du har ringt utanför våra öppettider, måndag till fredag 9 till 18.",
      "Lämna ditt namn, telefonnummer och vad det gäller efter pipet, så hör vi av oss nästa arbetsdag.",
      "",
      "Genom att lämna ett meddelande godkänner du att samtalet spelas in och lagras i 90 dagar för att vi ska kunna återkomma."
    ].join("\n")
  },
  {
    file: "hold-music.mp3",
    text: "Ett ögonblick, vi kopplar dig vidare."
  }
];

for (const prompt of prompts) {
  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`);
  url.searchParams.set("output_format", "mp3_44100_128");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg"
    },
    body: JSON.stringify({
      text: prompt.text,
      model_id: modelId,
      voice_settings: {
        stability: 0.6,
        similarity_boost: 0.75,
        style: 0.15,
        use_speaker_boost: true
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to generate ${prompt.file}: ${response.status} ${await response.text()}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(join(outputDir, prompt.file), bytes);
  console.log(`Generated ${prompt.file}`);
}
