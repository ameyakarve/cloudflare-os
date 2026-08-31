import {
  Fragment,
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Badge,
  Banner,
  Button,
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
const runtimeGlobal = globalThis as typeof globalThis & Record<string, unknown>;

runtimeGlobal.React = Object.freeze({
  Fragment,
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
});

runtimeGlobal.Kumo = Object.freeze({
  Badge,
  Banner,
  Button,
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

document.documentElement.style.colorScheme = "light dark";
document.body.classList.add("bg-kumo-canvas", "text-kumo-default");

runtimeGlobal.GadgetUI = Object.freeze({
  mount(node: ReactNode): Root {
    const root = createRoot(document.body);
    root.render(node);
    return root;
  },
});
