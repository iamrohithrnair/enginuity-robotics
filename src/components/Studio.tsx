"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { connect, loadSettings } from "@/client/api";
import { openFiles } from "@/client/fileActions";
import { useRC, useViewState } from "@/client/store";
import { useShortcuts } from "@/client/shortcuts";
import { useInteraction } from "@/client/interaction";
import DialogHost from "./DialogHost";
import ProgramDialogs from "./program/ProgramDialogs";
import StatusBar from "./StatusBar";
import LiquidFilter from "./glass/LiquidFilter";
import TopBar from "./TopBar";
import StationTree from "./StationTree";
import Inspector from "./inspector/Inspector";
import SimDock from "./SimDock";
import ChatPanel from "./ChatPanel";
import LibraryBrowser from "./LibraryBrowser";
import CommandPalette from "./CommandPalette";
import SettingsDialog from "./SettingsDialog";
import CodeViewer from "./CodeViewer";
import Toasts from "./Toasts";
import DecisionsHost from "./decisions/DecisionsHost";
import PostEditorHost from "./PostEditorDialog";
import CollisionMapHost from "./CollisionMapDialog";
import UtilitiesHost from "./contrib/utilities";
import A3Host from "./contrib/a3";
import SyncHost from "./contrib/sync";
import ScriptEditorHost from "./scripts/ScriptEditor";
import ViewTools from "./ViewTools";
import MachiningUi from "./MachiningUi";
import { toolbarsFor } from "./menuBar";

const Viewport = dynamic(() => import("./viewport/Viewport"), { ssr: false });

export default function Studio() {
  const rightPanel = useRC((s) => s.rightPanel);
  const theme = useRC((s) => s.settings.RC_THEME as string | undefined);
  const view = useViewState();
  const cinema = view.cinema;
   
  const simDock = toolbarsFor(view.toolbar).includes("Simulation");
  const bgTop = useRC((s) => s.settings.ColorBgTop as string | undefined);
  const bgBottom = useRC((s) => s.settings.ColorBgBottom as string | undefined);
  useShortcuts();
  useInteraction();

  useEffect(() => {
    connect();
    void loadSettings();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
  }, [theme]);

   
  useEffect(() => {
    document.body.style.background = bgTop || bgBottom ? `linear-gradient(180deg, ${bgTop || bgBottom}, ${bgBottom || bgTop})` : "";
  }, [bgTop, bgBottom]);

   
   
  const activeStation = useRC((s) => s.ws?.activeStation ?? null);
  useEffect(() => {
    const name = activeStation ? useRC.getState().ws?.items[activeStation]?.name : undefined;
    document.title = name !== undefined ? `Enginuity - ${name}` : "Enginuity";
  }, [activeStation]);

  return (
    <main
      data-tree={!view.treeVisible ? "hidden" : view.treeInside ? "inside" : "docked"}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void openFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <LiquidFilter />
      <Viewport />
      <div className="progressive-top" />
      {!cinema && <TopBar />}
      <StationTree />
      {rightPanel === "inspector" && <Inspector />}
      {rightPanel === "chat" && <ChatPanel />}
      {!cinema && simDock && <SimDock />}
      {!cinema && <StatusBar />}
      <DialogHost />
      <ProgramDialogs />
      <LibraryBrowser />
      <CommandPalette />
      <SettingsDialog />
      <DecisionsHost />
      <PostEditorHost />
      <CollisionMapHost />
      <UtilitiesHost />
      <A3Host />
      <SyncHost />
      <ScriptEditorHost />
      <CodeViewer />
      <ViewTools />
      <MachiningUi />
      <Toasts />
    </main>
  );
}
