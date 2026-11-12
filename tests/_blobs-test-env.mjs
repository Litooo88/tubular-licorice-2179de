// Importeras FÖRST i tester som kör mot den lokala Blobs-servern: @netlify/blobs
// läser NODE_ENV vid modulladdning och väntar då 1 ms (i stället för 5 s)
// mellan sina egna omförsök vid nätfel. Påverkar ingen funktionskod.
// Sätts ovillkorat: Netlifys byggmiljö kan ha NODE_ENV satt, och då skulle
// varje simulerat nätfel kosta 5 × 5 s i SDK:ns omförsök.
process.env.NODE_ENV = "test";
