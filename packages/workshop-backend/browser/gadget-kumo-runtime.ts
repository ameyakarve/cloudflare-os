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

declare global {
  // Gadget client code is an unbundled ES module, so the platform provides its UI dependencies as
  // globals. These are deliberately the real React/Kumo exports, not platform reimplementations.
  var React: Readonly<{
    Fragment: typeof Fragment;
    createElement: typeof createElement;
    useCallback: typeof useCallback;
    useEffect: typeof useEffect;
    useMemo: typeof useMemo;
    useRef: typeof useRef;
    useState: typeof useState;
  }>;
  var Kumo: Readonly<{
    Badge: typeof Badge;
    Banner: typeof Banner;
    Button: typeof Button;
    Combobox: typeof Combobox;
    Empty: typeof Empty;
    Field: typeof Field;
    Grid: typeof Grid;
    Input: typeof Input;
    LayerCard: typeof LayerCard;
    Loader: typeof Loader;
    Select: typeof Select;
    Surface: typeof Surface;
    Tabs: typeof Tabs;
    Text: typeof Text;
    cn: typeof cn;
  }>;
  var kumo: typeof Kumo;
  var GadgetUI: Readonly<{ mount(node: ReactNode): Root }>;
}

globalThis.React = Object.freeze({
  Fragment,
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
});

globalThis.Kumo = Object.freeze({
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
globalThis.kumo = globalThis.Kumo;

document.documentElement.style.colorScheme = "light dark";
document.body.classList.add("bg-kumo-canvas", "text-kumo-default");

globalThis.GadgetUI = Object.freeze({
  mount(node: ReactNode): Root {
    const root = createRoot(document.body);
    root.render(node);
    return root;
  },
});
