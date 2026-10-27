"""Behavioral examples for the PROPOSED MVP boundary; no TP or app execution."""
import json
import unittest
from pathlib import Path

from jsonschema import Draft7Validator

SCHEMA = json.loads((Path(__file__).parent / "mvp-interface-v1.schema.json").read_text(encoding="utf-8"))


def validator_for(name):
    return Draft7Validator({
        "$schema": SCHEMA["$schema"],
        "definitions": SCHEMA["definitions"],
        "$ref": "#/definitions/" + name,
    })


class ContractTests(unittest.TestCase):
    def test_schema_is_well_formed(self):
        Draft7Validator.check_schema(SCHEMA)

    def test_availability_never_exposes_batch_quantities(self):
        valid = validator_for("availabilityResponse")
        self.assertTrue(valid.is_valid({"authority": "batch_inventory", "items": [{"variantId": "variant_a", "status": "unknown"}]}))
        self.assertFalse(valid.is_valid({"authority": "native_stock", "items": [{"variantId": "v", "status": "available"}]}))
        self.assertFalse(valid.is_valid({"authority": "batch_inventory", "items": [{"variantId": "v", "status": "available", "quantity": 500}]}))
        self.assertFalse(valid.is_valid({"authority": "batch_inventory", "items": [{"variantId": "v", "status": "sold_out"}]}))

    def test_command_does_not_accept_client_money_or_authority(self):
        valid = validator_for("checkoutCommand")
        base = {"cartId": "cart_abc", "idempotencyKey": "d9ddc33a-9b44-4c84-b36d-f9d5934bc7bd", "paymentMethod": "cod"}
        self.assertTrue(valid.is_valid(base))
        self.assertTrue(valid.is_valid({**base, "paymentMethod": "electronic"}))
        for extra in [{"amountMinor": "6170"}, {"orderId": "order_123"}, {"ownerId": "worker"}, {"batchId": "batch_secret"}, {"price": 61.7}]:
            with self.subTest(extra=extra):
                self.assertFalse(valid.is_valid({**base, **extra}))
        self.assertFalse(valid.is_valid({**base, "idempotencyKey": "free-form"}))

    def test_completed_result_is_exact_egp_and_no_internals(self):
        valid = validator_for("checkoutResult")
        base = {"status": "completed", "orderId": "order_abc", "currency": "EGP", "totalMinor": "6170", "orderVersion": 1}
        self.assertTrue(valid.is_valid(base))
        for extra in [{"totalMinor": 6170}, {"totalMinor": "0"}, {"currency": "USD"},
                      {"orderVersion": 0}, {"checkoutAttemptId": "internal"}]:
            with self.subTest(extra=extra):
                self.assertFalse(valid.is_valid({**base, **extra}))

    def test_pending_and_blocked_do_not_claim_paid_or_leak_internal_data(self):
        valid = validator_for("checkoutResult")
        self.assertTrue(valid.is_valid({"status": "pending_reconciliation", "reference": "opaque_ref", "retryAfterSeconds": 10}))
        self.assertFalse(valid.is_valid({"status": "pending_reconciliation", "reference": "opaque_ref", "orderId": "order_abc"}))
        self.assertTrue(valid.is_valid({"status": "blocked", "reasonCode": "CART_NOT_READY"}))
        self.assertFalse(valid.is_valid({"status": "blocked", "reasonCode": "SQL_ERROR", "sql": "secret"}))
        self.assertFalse(valid.is_valid({"status": "blocked", "reasonCode": "OUT_OF_STOCK", "amountMinor": "100"}))


if __name__ == "__main__":
    unittest.main()
