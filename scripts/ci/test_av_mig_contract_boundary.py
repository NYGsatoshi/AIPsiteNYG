#!/usr/bin/env python3
"""Deterministic negative tests for the AV-MIG-02 contract-boundary verifier."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import verify_av_mig_contract_boundary as verifier


REPO_ROOT = Path(__file__).resolve().parents[2]
POLICY_PATH = REPO_ROOT / "docs/migration/avalonia/p0-api-boundary.json"


def build_document(policy: dict[str, object]) -> dict[str, object]:
    openapi_policy = policy["openapi"]
    assert isinstance(openapi_policy, dict)
    security_policy = openapi_policy["requiredSecurityScheme"]
    assert isinstance(security_policy, dict)
    scheme_name = security_policy["name"]
    assert isinstance(scheme_name, str)

    paths: dict[str, object] = {}
    required_operations = policy["requiredOperations"]
    assert isinstance(required_operations, list)
    for entry in required_operations:
        assert isinstance(entry, dict)
        path = entry["path"]
        method = entry["method"]
        anonymous = entry["anonymous"]
        assert isinstance(path, str)
        assert isinstance(method, str)
        assert isinstance(anonymous, bool)
        path_item = paths.setdefault(path, {})
        assert isinstance(path_item, dict)
        path_item[method.lower()] = {
            "responses": {"200": {"description": "fixture"}},
            "security": [] if anonymous else [{scheme_name: []}],
        }

    return {
        "openapi": "3.1.1",
        "components": {
            "securitySchemes": {
                scheme_name: {
                    "type": security_policy["type"],
                    "in": security_policy["in"],
                    "name": security_policy["parameterName"],
                }
            }
        },
        "paths": paths,
    }


def write_source_fixture(root: Path, policy: dict[str, object]) -> None:
    contracts = policy["nonOpenApiContracts"]
    assert isinstance(contracts, dict)
    signalr = contracts["signalR"]
    csrf = contracts["csrf"]
    assert isinstance(signalr, dict)
    assert isinstance(csrf, dict)

    program = root / "src/AipPortal.Web/Program.cs"
    hub = root / "src/AipPortal.Web/Realtime/AppHub.cs"
    dispatcher = root / "src/AipPortal.Web/Realtime/OutboxDispatcher.cs"
    invalidator = root / "src/AipPortal.Web/Realtime/RealtimeConnectionInvalidator.cs"
    security_controller = root / "src/AipPortal.Web/Controllers/SecurityController.cs"
    security_options = root / "src/AipPortal.Web/Configuration/SecurityOptions.cs"
    for path in (
        program,
        hub,
        dispatcher,
        invalidator,
        security_controller,
        security_options,
    ):
        path.parent.mkdir(parents=True, exist_ok=True)

    program.write_text(
        f'app.MapHub<AppHub>("{signalr["path"]}");\n',
        encoding="utf-8",
    )

    client_methods = signalr["clientMethods"]
    assert isinstance(client_methods, list)
    hub.write_text(
        "\n".join(
            f"public Task<HubSubscriptionResult> {method}(Guid value) => "
            "Task.FromResult(new HubSubscriptionResult(true, \"ok\"));"
            for method in client_methods
        )
        + "\n",
        encoding="utf-8",
    )

    server_events = signalr["serverEvents"]
    assert isinstance(server_events, list)
    event_sources = [dispatcher, invalidator]
    for index, event_name in enumerate(server_events):
        target = event_sources[index % len(event_sources)]
        with target.open("a", encoding="utf-8") as handle:
            handle.write(
                f'await hubContext.Clients.All.SendAsync("{event_name}", cancellationToken);\n'
            )

    token_endpoint = csrf["tokenEndpoint"]
    header_name = csrf["headerName"]
    assert isinstance(token_endpoint, str)
    assert isinstance(header_name, str)
    route_prefix, action_route = token_endpoint.removeprefix("/").rsplit("/", 1)
    security_controller.write_text(
        (
            f'[Route("{route_prefix}")]\n'
            "public sealed class SecurityController\n"
            "{\n"
            f'    [HttpGet("{action_route}")]\n'
            "    [AllowAnonymous]\n"
            "    public ActionResult<CsrfTokenResponse> CsrfToken()\n"
            "    {\n"
            "        return Ok(new CsrfTokenResponse("
            "tokens.RequestToken ?? string.Empty, SecurityOptions.CsrfHeaderName));\n"
            "    }\n"
            "}\n"
        ),
        encoding="utf-8",
    )
    security_options.write_text(
        f'public const string CsrfHeaderName = "{header_name}";\n',
        encoding="utf-8",
    )


class ContractBoundaryMutationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.policy = verifier.load_policy(POLICY_PATH)

    def make_fixture(self):
        temp = tempfile.TemporaryDirectory()
        root = Path(temp.name)
        write_source_fixture(root, self.policy)
        document = build_document(self.policy)
        return temp, root, document

    def protected_operation(self, document):
        required = self.policy["requiredOperations"]
        entry = next(item for item in required if item.get("anonymous") is False)
        return document["paths"][entry["path"]][entry["method"].lower()]

    def anonymous_operation(self, document):
        required = self.policy["requiredOperations"]
        entry = next(item for item in required if item.get("anonymous") is True)
        return document["paths"][entry["path"]][entry["method"].lower()]

    def test_positive_fixture_passes(self) -> None:
        temp, root, document = self.make_fixture()
        self.addCleanup(temp.cleanup)
        verifier.verify_boundary(document, self.policy, root)

    def test_protected_security_deletion_fails(self) -> None:
        temp, root, document = self.make_fixture()
        self.addCleanup(temp.cleanup)
        self.protected_operation(document).pop("security")
        with self.assertRaisesRegex(verifier.BoundaryViolation, "non-empty security"):
            verifier.verify_boundary(document, self.policy, root)

    def test_protected_empty_security_fails(self) -> None:
        temp, root, document = self.make_fixture()
        self.addCleanup(temp.cleanup)
        self.protected_operation(document)["security"] = []
        with self.assertRaisesRegex(verifier.BoundaryViolation, "non-empty security"):
            verifier.verify_boundary(document, self.policy, root)

    def test_protected_anonymous_alternative_fails(self) -> None:
        temp, root, document = self.make_fixture()
        self.addCleanup(temp.cleanup)
        self.protected_operation(document)["security"] = [
            {"CookieAuth": []},
            {},
        ]
        with self.assertRaisesRegex(verifier.BoundaryViolation, "alternative 1 must require CookieAuth"):
            verifier.verify_boundary(document, self.policy, root)

    def test_protected_other_scheme_alternative_fails(self) -> None:
        temp, root, document = self.make_fixture()
        self.addCleanup(temp.cleanup)
        components = document["components"]
        assert isinstance(components, dict)
        security_schemes = components["securitySchemes"]
        assert isinstance(security_schemes, dict)
        security_schemes["OtherScheme"] = {
            "type": "apiKey",
            "in": "header",
            "name": "X-Other-Auth",
        }
        self.protected_operation(document)["security"] = [
            {"CookieAuth": []},
            {"OtherScheme": []},
        ]
        with self.assertRaisesRegex(verifier.BoundaryViolation, "alternative 1 must require CookieAuth"):
            verifier.verify_boundary(document, self.policy, root)

    def test_anonymous_cookie_auth_fails(self) -> None:
        temp, root, document = self.make_fixture()
        self.addCleanup(temp.cleanup)
        self.anonymous_operation(document)["security"] = [{"CookieAuth": []}]
        with self.assertRaisesRegex(verifier.BoundaryViolation, "explicitly declare security"):
            verifier.verify_boundary(document, self.policy, root)

    def test_anonymous_root_security_inheritance_fails(self) -> None:
        temp, root, document = self.make_fixture()
        self.addCleanup(temp.cleanup)
        document["security"] = [{"CookieAuth": []}]
        self.anonymous_operation(document).pop("security")
        with self.assertRaisesRegex(verifier.BoundaryViolation, "explicitly declare security"):
            verifier.verify_boundary(document, self.policy, root)

    def test_hub_method_change_fails(self) -> None:
        temp, root, document = self.make_fixture()
        self.addCleanup(temp.cleanup)
        hub = root / "src/AipPortal.Web/Realtime/AppHub.cs"
        source = hub.read_text(encoding="utf-8")
        method = self.policy["nonOpenApiContracts"]["signalR"]["clientMethods"][0]
        hub.write_text(source.replace(f" {method}(", f" {method}Changed("), encoding="utf-8")
        with self.assertRaisesRegex(verifier.BoundaryViolation, "client method is missing"):
            verifier.verify_boundary(document, self.policy, root)

    def test_hub_method_commented_out_fails(self) -> None:
        temp, root, document = self.make_fixture()
        self.addCleanup(temp.cleanup)
        hub = root / "src/AipPortal.Web/Realtime/AppHub.cs"
        source = hub.read_text(encoding="utf-8")
        method = self.policy["nonOpenApiContracts"]["signalR"]["clientMethods"][0]
        lines = source.splitlines()
        hub.write_text(
            "\n".join("// " + line if f" {method}(" in line else line for line in lines) + "\n",
            encoding="utf-8",
        )
        with self.assertRaisesRegex(verifier.BoundaryViolation, "client method is missing"):
            verifier.verify_boundary(document, self.policy, root)

    def test_hub_event_change_fails(self) -> None:
        temp, root, document = self.make_fixture()
        self.addCleanup(temp.cleanup)
        realtime = root / "src/AipPortal.Web/Realtime"
        event_name = self.policy["nonOpenApiContracts"]["signalR"]["serverEvents"][0]
        for path in realtime.glob("*.cs"):
            source = path.read_text(encoding="utf-8")
            if event_name in source:
                path.write_text(source.replace(event_name, event_name + "Changed"), encoding="utf-8")
                break
        with self.assertRaisesRegex(verifier.BoundaryViolation, "server event is not emitted"):
            verifier.verify_boundary(document, self.policy, root)

    def test_hub_event_commented_out_fails(self) -> None:
        temp, root, document = self.make_fixture()
        self.addCleanup(temp.cleanup)
        realtime = root / "src/AipPortal.Web/Realtime"
        event_name = self.policy["nonOpenApiContracts"]["signalR"]["serverEvents"][0]
        for path in realtime.glob("*.cs"):
            source = path.read_text(encoding="utf-8")
            if event_name in source:
                path.write_text(source.replace(source, f"/* {source} */\n"), encoding="utf-8")
                break
        with self.assertRaisesRegex(verifier.BoundaryViolation, "server event is not emitted"):
            verifier.verify_boundary(document, self.policy, root)

    def test_hub_path_change_fails(self) -> None:
        temp, root, document = self.make_fixture()
        self.addCleanup(temp.cleanup)
        program = root / "src/AipPortal.Web/Program.cs"
        source = program.read_text(encoding="utf-8")
        expected = self.policy["nonOpenApiContracts"]["signalR"]["path"]
        program.write_text(source.replace(expected, expected + "-changed"), encoding="utf-8")
        with self.assertRaisesRegex(verifier.BoundaryViolation, "AppHub path drifted"):
            verifier.verify_boundary(document, self.policy, root)

    def test_hub_path_commented_out_fails(self) -> None:
        temp, root, document = self.make_fixture()
        self.addCleanup(temp.cleanup)
        program = root / "src/AipPortal.Web/Program.cs"
        source = program.read_text(encoding="utf-8")
        program.write_text("// " + source, encoding="utf-8")
        with self.assertRaisesRegex(verifier.BoundaryViolation, "AppHub path drifted"):
            verifier.verify_boundary(document, self.policy, root)

    def test_csrf_header_change_fails(self) -> None:
        temp, root, document = self.make_fixture()
        self.addCleanup(temp.cleanup)
        options = root / "src/AipPortal.Web/Configuration/SecurityOptions.cs"
        source = options.read_text(encoding="utf-8")
        expected = self.policy["nonOpenApiContracts"]["csrf"]["headerName"]
        options.write_text(source.replace(expected, expected + "-Changed"), encoding="utf-8")
        with self.assertRaisesRegex(verifier.BoundaryViolation, "CSRF header drifted"):
            verifier.verify_boundary(document, self.policy, root)

    def test_csrf_header_commented_out_fails(self) -> None:
        temp, root, document = self.make_fixture()
        self.addCleanup(temp.cleanup)
        options = root / "src/AipPortal.Web/Configuration/SecurityOptions.cs"
        source = options.read_text(encoding="utf-8")
        options.write_text("// " + source, encoding="utf-8")
        with self.assertRaisesRegex(verifier.BoundaryViolation, "CsrfHeaderName is missing"):
            verifier.verify_boundary(document, self.policy, root)

    def test_csrf_endpoint_change_fails(self) -> None:
        temp, root, document = self.make_fixture()
        self.addCleanup(temp.cleanup)
        controller = root / "src/AipPortal.Web/Controllers/SecurityController.cs"
        source = controller.read_text(encoding="utf-8")
        token_endpoint = self.policy["nonOpenApiContracts"]["csrf"]["tokenEndpoint"]
        assert isinstance(token_endpoint, str)
        _, action_route = token_endpoint.removeprefix("/").rsplit("/", 1)
        controller.write_text(
            source.replace(
                f'HttpGet("{action_route}")',
                f'HttpGet("{action_route}-changed")',
            ),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(verifier.BoundaryViolation, "CSRF token endpoint drifted"):
            verifier.verify_boundary(document, self.policy, root)

    def test_csrf_endpoint_commented_out_fails(self) -> None:
        temp, root, document = self.make_fixture()
        self.addCleanup(temp.cleanup)
        controller = root / "src/AipPortal.Web/Controllers/SecurityController.cs"
        source = controller.read_text(encoding="utf-8")
        token_endpoint = self.policy["nonOpenApiContracts"]["csrf"]["tokenEndpoint"]
        assert isinstance(token_endpoint, str)
        _, action_route = token_endpoint.removeprefix("/").rsplit("/", 1)
        controller.write_text(
            source.replace(
                f'    [HttpGet("{action_route}")]',
                f'    /* [HttpGet("{action_route}")] */',
            ),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(verifier.BoundaryViolation, "controller route/action contract is missing"):
            verifier.verify_boundary(document, self.policy, root)


if __name__ == "__main__":
    unittest.main()
