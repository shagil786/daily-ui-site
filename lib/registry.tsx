import type { ComponentType } from "react";
import { z } from "zod";
import {
  Center,
  Grid,
  Section,
  SplitPane,
  Stack,
  Tabs,
  Timeline,
  centerPropsSchema,
  gridPropsSchema,
  sectionPropsSchema,
  splitPanePropsSchema,
  stackPropsSchema,
  tabsPropsSchema,
  timelinePropsSchema,
} from "./components/layout";

export type ComponentEntry = {
  propsSchema: z.ZodTypeAny;
  /**
   * Props are validated by `propsSchema` before render; `any` here is pinned
   * by the registry interface so heterogeneous components can share one map.
   */
  Component: ComponentType<any>;
};

/**
 * Every renderable component, keyed by `Node.componentType`. This is the only
 * place component types are added; later tasks append their entries below.
 */
export const registry: Record<string, ComponentEntry> = {
  // Layout (Task 3)
  Stack: { propsSchema: stackPropsSchema, Component: Stack },
  Center: { propsSchema: centerPropsSchema, Component: Center },
  Grid: { propsSchema: gridPropsSchema, Component: Grid },
  Section: { propsSchema: sectionPropsSchema, Component: Section },
  SplitPane: { propsSchema: splitPanePropsSchema, Component: SplitPane },
  Tabs: { propsSchema: tabsPropsSchema, Component: Tabs },
  Timeline: { propsSchema: timelinePropsSchema, Component: Timeline },
};

/** Look up an entry by `Node.componentType`; unknown types yield `undefined` (never throws). */
export function getComponent(type: string): ComponentEntry | undefined {
  return Object.prototype.hasOwnProperty.call(registry, type) ? registry[type] : undefined;
}

/** JSON-safe `[{type, propsDescription}]` inventory of the registry, for the generation prompt. */
export function inventoryForPrompt(): unknown {
  return Object.keys(registry)
    .sort()
    .map((type) => {
      const description = getComponent(type)?.propsSchema.description;
      return {
        type,
        propsDescription:
          typeof description === "string" && description.length > 0
            ? description
            : "no documented props",
      };
    });
}
