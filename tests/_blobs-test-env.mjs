// Importeras FÖRST i tester som kör mot den lokala Blobs-servern: @netlify/blobs
// läser NODE_ENV vid modulladdning och väntar då 1 ms (i stället för 5 s)
// mellan sina egna omförsök vid nätfel. Påverkar ingen funktionskod.
process.env.NODE_ENV = process.env.NODE_ENV || "test";
