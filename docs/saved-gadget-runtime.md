# Saved Gadget source and runtime compatibility

Ordinary Gadgets execute their saved source. Rendering may prepend a runtime library, but it must not replace the client because it contains strings also found in a deployment blueprint. An updated blueprint supplies code for new instances; it does not authorize silently replacing existing instances or their customizations.

`withGadgetKumo` preserves the complete input client. A saved client that explicitly uses the historical Kumo helper ABI receives its compatibility runtime; modern clients receive the current runtime. Optional graph and geography helpers are likewise runtime dependencies, not replacement application code. The deployment no longer embeds `GADGET_CLIENT_UPGRADE_PATH` or `GADGET_LEDGER_CLIENT_UPGRADE_PATH` replacement payloads.

The deliberately managed Ledger output is a separate security boundary. Trusted `systemOutput: "ledger"` metadata selects an inert dynamic server, while a browser-only capability supplies direct journal editing. The marker is assigned by the platform, not inferred from a title or client text. This change retains that restriction: historical managed server code must not expose the browser Save authority to agents. Consolidating that managed output into a generic first-party application extension remains architectural work.

No saved source, Git history, chat history, bindings, or SQLite data is rewritten by this change. Older ordinary clients can therefore retain older behavior; any future migration must be explicit, versioned, and preserve customized instances. Regression fixtures cover all former substitution markers and user-added code through the actual renderer.
