// eLks voice routing — bara ring Sebastian, SMS-notis när samtalet slutat
// Telesvar tas om hand av Sebastians mobiloperatör

export default async (request) => {
  const SEBASTIAN = process.env.VOICE_PRIMARY_NUMBER || "+46700243319";
    const origin = new URL(request.url).origin;

      const response = {
          connect: SEBASTIAN,
              timeout: 25,
                  whenhangup: `${origin}/.netlify/functions/voice-notify`
                    };

                      return new Response(JSON.stringify(response), {
                          status: 200,
                              headers: { "Content-Type": "application/json" }
                                });
                                };
                                
