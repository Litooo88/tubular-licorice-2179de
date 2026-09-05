const clean = (value, max = 240) => String(value || "").trim().slice(0, max);

const normalize = (value) =>
  clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const GENERIC_VALUES = new Set([
  "annat",
  "elcykel",
  "elscooter",
  "ej angiven",
  "ingen aning",
  "modell saknas",
  "n a",
  "okand",
  "osaker",
  "scooter",
  "vet ej",
  "vet inte",
]);

const BRAND_ONLY_VALUES = new Set([
  "augment",
  "dualtron",
  "emove",
  "e wheels",
  "ewheels",
  "halo knight",
  "inokim",
  "iscooter",
  "kugoo",
  "kukirin",
  "navee",
  "ninebot",
  "rawbike",
  "segway",
  "teverun",
  "vsett",
  "xiaomi",
]);

export const isProductOrderService = (service) => /^best[aä]llning av\s+/i.test(clean(service));

export const requiresVehicleIdentity = ({ service, logistics } = {}) =>
  !isProductOrderService(service) && clean(logistics, 80) !== "pickup-ready";

export const validateVehicleIdentity = ({ brand, model, required = true } = {}) => {
  if (!required) return "";

  const normalizedBrand = normalize(brand);
  const normalizedModel = normalize(model);

  if (!normalizedBrand || GENERIC_VALUES.has(normalizedBrand)) {
    return "Ange fordonets fabrikat eller märke, till exempel NAVEE.";
  }
  if (
    !normalizedModel ||
    GENERIC_VALUES.has(normalizedModel) ||
    BRAND_ONLY_VALUES.has(normalizedModel) ||
    normalizedModel === normalizedBrand
  ) {
    return "Skriv den exakta modellbeteckningen, till exempel N65i eller ST3 Pro – inte bara märket.";
  }

  return "";
};

export const vehicleIdentityLabel = (vehicle = {}) => {
  const brand = clean(vehicle.brand, 120);
  const model = clean(vehicle.model, 240);
  if (!brand) return model;
  if (!model) return brand;

  const normalizedBrand = normalize(brand);
  const normalizedModel = normalize(model);
  if (normalizedModel === normalizedBrand || normalizedModel.startsWith(`${normalizedBrand} `)) return model;
  return `${brand} ${model}`;
};
