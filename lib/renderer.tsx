"use client";

import React, { type ReactNode } from "react";
import { getComponent } from "./registry";
import type { Node } from "./schema";

/**
 * Client boundary: `NodeErrorBoundary` extends `React.Component`, which the
 * `react-server` export condition does not provide — importing this module
 * from a Server Component page crashes at module evaluation (next build).
 * Pages stay server components and pass `node` as plain JSON across the
 * boundary; SSR still emits the full markup (this directive only switches the
 * React runtime for hydration, it does not opt the page out of streaming).
 */

type NodeErrorBoundaryProps = { children: ReactNode };
type NodeErrorBoundaryState = { hasError: boolean };

/**
 * Per-node error boundary. React only supports error boundaries as class
 * components (`componentDidCatch` / `getDerivedStateFromError`), so every node's
 * subtree is wrapped individually: a throwing component degrades to the
 * fallback while its siblings keep rendering. The fallback is intentionally
 * empty — it must never expose the failed node's props or type name.
 */
class NodeErrorBoundary extends React.Component<
  NodeErrorBoundaryProps,
  NodeErrorBoundaryState
> {
  state: NodeErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): NodeErrorBoundaryState {
    return { hasError: true };
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <div data-testid="node-error" role="presentation" />;
    }
    return this.props.children;
  }
}

/**
 * Recursive `Node` → React walker. Looks the component up in the registry;
 * unknown types render a benign placeholder instead of throwing. Children come
 * from `Node.children` (never from `props`) and are passed to the component
 * via the `children` prop; `node.props` itself is forwarded as-is because
 * validation already happened upstream in `validateDocument`.
 */
export function Renderer({ node }: { node: Node }): React.JSX.Element {
  const entry = getComponent(node.componentType);
  if (entry === undefined) {
    // The type name identifies generated structure, so it is dev-only; in
    // production the placeholder reveals nothing.
    return (
      <div data-testid="unknown-component" role="presentation">
        {process.env.NODE_ENV !== "production" ? node.componentType : null}
      </div>
    );
  }

  const { Component } = entry;
  const children = (node.children ?? []).map((child) => (
    <Renderer key={child.id} node={child} />
  ));

  return (
    <NodeErrorBoundary>
      <Component {...node.props}>{children}</Component>
    </NodeErrorBoundary>
  );
}
