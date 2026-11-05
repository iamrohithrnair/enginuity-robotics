 
 
 

// Registers and resolves custom editors by instruction kind.
import type { ReactNode } from "react";
import type { InstructionData, Item } from "@/engine/types";

export type InstructionEditor = (p: { it: Item; ins: InstructionData }) => ReactNode;

const editors = new Map<string, InstructionEditor>();

export function registerInstructionEditor(kind: string, Editor: InstructionEditor) {
  editors.set(kind, Editor);
}

export function instructionEditor(kind: string): InstructionEditor | undefined {
  return editors.get(kind);
}
