"use client";
// Opens the post-processor editor for the selected robot's post.

 
 

import { registerUiAction } from "@/client/uiActions";
import { useRC } from "@/client/store";
import { openPostEditor } from "../PostEditorDialog";

 
const robotPost = (): string | null => {
  const ws = useRC.getState().ws;
  const sel = (ws?.selection ?? []).map((id) => ws?.items[id]).find((i) => i?.type === "robot" || (i?.type === "program" && i.program?.robot));
  const robot = sel?.type === "robot" ? sel : sel?.program?.robot ? ws?.items[sel.program.robot] : undefined;
  return robot?.robot?.postProcessor || null;
};

registerUiAction("actionEdit_Post_Processor", () => openPostEditor(robotPost()));
registerUiAction("action-AddEditPost", () => openPostEditor(robotPost()));
