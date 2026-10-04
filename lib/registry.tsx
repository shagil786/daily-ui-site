import type { ComponentType } from "react";
import { z } from "zod";
import { Center, Grid, Section, SplitPane, Stack, Timeline } from "./components/layout";
import { Tabs } from "./components/tabs";
import {
  accordionPropsSchema,
  beforeAfterPropsSchema,
  canvasNoisePropsSchema,
  cardPropsSchema,
  centerPropsSchema,
  clickerPropsSchema,
  clockPropsSchema,
  counterPropsSchema,
  gridPropsSchema,
  heroPropsSchema,
  imageGalleryPropsSchema,
  linkListPropsSchema,
  marqueePropsSchema,
  pollPropsSchema,
  progressBarPropsSchema,
  sectionPropsSchema,
  splitPanePropsSchema,
  stackPropsSchema,
  tabsPropsSchema,
  terminalSimPropsSchema,
  textPropsSchema,
  timelinePropsSchema,
  todoPropsSchema,
} from "./component-props";
import { BeforeAfter, Card, Hero, ImageGallery, LinkList, TerminalSim, Text } from "./components/content";
import { Accordion, CanvasNoise, Clicker, Clock, Counter, Marquee, Poll, ProgressBar, Todo } from "./components/interactive";

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
  // Content (Task 4)
  Hero: { propsSchema: heroPropsSchema, Component: Hero },
  Text: { propsSchema: textPropsSchema, Component: Text },
  Card: { propsSchema: cardPropsSchema, Component: Card },
  ImageGallery: { propsSchema: imageGalleryPropsSchema, Component: ImageGallery },
  LinkList: { propsSchema: linkListPropsSchema, Component: LinkList },
  BeforeAfter: { propsSchema: beforeAfterPropsSchema, Component: BeforeAfter },
  TerminalSim: { propsSchema: terminalSimPropsSchema, Component: TerminalSim },
  // Interactive (Task 5)
  Counter: { propsSchema: counterPropsSchema, Component: Counter },
  Todo: { propsSchema: todoPropsSchema, Component: Todo },
  Poll: { propsSchema: pollPropsSchema, Component: Poll },
  Clock: { propsSchema: clockPropsSchema, Component: Clock },
  Clicker: { propsSchema: clickerPropsSchema, Component: Clicker },
  Marquee: { propsSchema: marqueePropsSchema, Component: Marquee },
  CanvasNoise: { propsSchema: canvasNoisePropsSchema, Component: CanvasNoise },
  ProgressBar: { propsSchema: progressBarPropsSchema, Component: ProgressBar },
  Accordion: { propsSchema: accordionPropsSchema, Component: Accordion },
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
