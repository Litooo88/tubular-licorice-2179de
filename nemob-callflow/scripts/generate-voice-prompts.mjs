import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("Missing ELEVENLABS_API_KEY.");
  process.exit(1);
}

// Default: Olivia (svensktalande, ung kvinnlig röst från ElevenLabs Voice Library).
// Override via ELEVENLABS_VOICE_ID env var om du vill testa annan röst.
const voiceId = process.env.ELEVENLABS_VOICE_ID || "cLAH1kXlkAivJHxCW601";
const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const outputDir = fileURLToPath(new URL("../../audio/", import.meta.url));
await mkdir(outputDir, { recursive: true });

// OBS: hold-music.mp3 genereras INTE här. Den är en Pixabay royalty-fri loop.
const prompts = [
  {
    file: "welcome.mp3",
    text: [
      "Hej, du har kommit till Nordic E-Mobility i Örebro.",
      "",
      "För att hjälpa dig snabbare — tryck ett för verkstad och service.",
      "Tryck två om du vill köpa ny elscooter eller har frågor om försäljning.",
      "",
      "Vill du höra alternativen igen, tryck noll.",
      "Annars kopplas du automatiskt till verkstaden."
    ].join("\n")
  },
  {
    file: "voicemail-prompt.mp3",
    text: [
      "Hej, just nu kan vi inte svara.",
      "",
      "Lämna ditt namn, ditt telefonnummer, och vad det gäller efter pipet — så hör vi av oss så snart vi kan.",
      "",
      "Genom att lämna ett meddelande godkänner du att samtalet spelas in och raderas efter 90 dagar."
    ].join("\n")
  },
  {
    file: "outside-hours-prompt.mp3",
    text: [
      "Hej, du har kommit till Nordic E-Mobility utanför våra öppettider, vardagar nio till sex.",
      "",
      "Lämna ett meddelande efter pipet så ringer vi upp dig första bästa tillfälle.",
      "",
      "Vi spelar in meddelandet och raderar det efter 90 dagar."
    ].join("\n")
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
        // Sänkt stability (0.45) + höjt style (0.30) = mer mänsklig/uttrycksfull röst.
        // Default (0.6/0.15) lät för robotaktig enligt Boss.
        stability: 0.45,
        similarity_boost: 0.75,
        style: 0.30,
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
