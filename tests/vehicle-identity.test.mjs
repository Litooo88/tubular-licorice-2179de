import test from "node:test";
import assert from "node:assert/strict";
import {
  requiresVehicleIdentity,
  validateVehicleIdentity,
  vehicleIdentityLabel,
} from "../netlify/functions/_shared/vehicle-identity.mjs";

test("service bookings require both brand and an exact model", () => {
  assert.match(validateVehicleIdentity({ brand: "", model: "N65i" }), /fabrikat/i);
  assert.match(validateVehicleIdentity({ brand: "NAVEE", model: "" }), /modellbeteckningen/i);
  assert.match(validateVehicleIdentity({ brand: "NAVEE", model: "NAVEE" }), /modellbeteckningen/i);
  assert.match(validateVehicleIdentity({ brand: "NAVEE", model: "elscooter" }), /modellbeteckningen/i);
  assert.equal(validateVehicleIdentity({ brand: "NAVEE", model: "N65i" }), "");
  assert.equal(validateVehicleIdentity({ brand: "Dualtron", model: "Thunder" }), "");
});

test("product orders and ready-pickup bookings are exempt", () => {
  assert.equal(requiresVehicleIdentity({ service: "Beställning av KuKirin G2", logistics: "dropoff" }), false);
  assert.equal(requiresVehicleIdentity({ service: "Punktering / däck", logistics: "pickup-ready" }), false);
  assert.equal(requiresVehicleIdentity({ service: "Punktering / däck", logistics: "dropoff" }), true);
  assert.equal(validateVehicleIdentity({ required: false }), "");
});

test("vehicle labels keep brand and exact model searchable without duplication", () => {
  assert.equal(vehicleIdentityLabel({ brand: "NAVEE", model: "N65i" }), "NAVEE N65i");
  assert.equal(vehicleIdentityLabel({ brand: "NAVEE", model: "NAVEE N65i" }), "NAVEE N65i");
  assert.equal(vehicleIdentityLabel({ model: "Xiaomi Pro 2" }), "Xiaomi Pro 2");
});
