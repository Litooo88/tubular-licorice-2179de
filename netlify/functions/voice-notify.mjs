// eLks whenhangup callback — skickar SMS-notis till Sebastian
// Triggas när ett inkommande samtal är slut (besvarat eller missat)

export default async (request) => {
  const SMS_TO = process.env.VOICE_NOTIFY_TO || "+46700243319";
    const FROM_NAME = process.env.SMS_FROM || "NordicEM";

      let from = "", state = "", duration = "0", actions = "";
        try {
            const ct = request.headers.get("content-type") || "";
                if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
                      const fd = await request.formData();
                            from = fd.get("from") || "";
                                  state = fd.get("state") || "";
                                        duration = fd.get("duration") || "0";
                                              actions = fd.get("actions") || "";
                                                  } else {
                                                        const txt = await request.text();
                                                              const p = new URLSearchParams(txt);
                                                                    from = p.get("from") || "";
                                                                          state = p.get("state") || "";
                                                                                duration = p.get("duration") || "0";
                                                                                    }
                                                                                      } catch (e) {
                                                                                          console.error("voice-notify parse error", e);
                                                                                            }

                                                                                              const callerNo = from || "okänt nummer";
                                                                                                const secs = parseInt(duration, 10) || 0;
                                                                                                  const answered = (state === "success" && secs > 5) || actions.includes("connect");

                                                                                                    const tid = new Date().toLocaleTimeString("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" });
                                                                                                      const msg = answered
                                                                                                          ? `[Nordic] ${tid} Besvarat samtal från ${callerNo} (${secs}s)`
                                                                                                              : `[Nordic] ${tid} MISSAT samtal från ${callerNo}. Ring upp eller skicka SMS.`;
                                                                                                              
                                                                                                                try {
                                                                                                                    const auth = Buffer.from(`${process.env.ELKS_USERNAME}:${process.env.ELKS_PASSWORD}`).toString("base64");
                                                                                                                        await fetch("https://api.46elks.com/a1/sms", {
                                                                                                                              method: "POST",
                                                                                                                                    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
                                                                                                                                          body: new URLSearchParams({ from: FROM_NAME, to: SMS_TO, message: msg })
                                                                                                                                              });
                                                                                                                                                } catch (e) {
                                                                                                                                                    console.error("voice-notify SMS error", e);
                                                                                                                                                      }
                                                                                                                                                      
                                                                                                                                                        return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
                                                                                                                                                        };
                                                                                                                                                        
