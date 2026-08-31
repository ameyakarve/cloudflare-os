import * as React from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Badge,
  Banner,
  Button,
  Collapsible,
  Combobox,
  Empty,
  Field,
  Grid,
  Input,
  LayerCard,
  Loader,
  Select,
  Surface,
  Tabs,
  Text,
  cn,
} from "@cloudflare/kumo";

// Gadget client code is an unbundled ES module, so the platform provides its UI dependencies as
// globals. These are deliberately the real React/Kumo exports, not platform reimplementations.
const runtimeGlobal = globalThis as unknown as Record<string, unknown>;

runtimeGlobal.React = React;

runtimeGlobal.Kumo = Object.freeze({
  Badge,
  Banner,
  Button,
  Collapsible,
  Combobox,
  Empty,
  Field,
  Grid,
  Input,
  LayerCard,
  Loader,
  Select,
  Surface,
  Tabs,
  Text,
  cn,
});
runtimeGlobal.kumo = runtimeGlobal.Kumo;

const initialMode = document.documentElement.dataset.mode;
document.documentElement.style.colorScheme = initialMode === "dark" ? "dark" : "light";
document.body.classList.add("bg-kumo-canvas", "text-kumo-default");

runtimeGlobal.GadgetUI = Object.freeze({
  mount(node: ReactNode): Root {
    const root = createRoot(document.body);
    root.render(node);
    return root;
  },
});
