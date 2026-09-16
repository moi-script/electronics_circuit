import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockBackend } from "@/backend/mockBackend";
import { createEditorStore, type EditorStore } from "@/model/store";
import { testLibrary } from "@/test/resetEditor";
import { createFileActions, type FileActions } from "./fileActions";

let store: EditorStore;
let backend: ReturnType<typeof createMockBackend>;
let files: FileActions;
let confirm: ReturnType<typeof vi.fn<() => boolean>>;
let notify: ReturnType<typeof vi.fn<(message: string) => void>>;
const s = () => store.getState();

beforeEach(() => {
  store = createEditorStore({ library: testLibrary });
  backend = createMockBackend();
  confirm = vi.fn(() => false);
  notify = vi.fn();
  files = createFileActions({ store, backend, confirmDiscard: confirm, notify });
  s().placePart("basic.resistor", [0, 0]);
});

describe("file actions", () => {
  it("saves an untitled project after asking for a path", async () => {
    const pick = vi.spyOn(backend, "pickSavePath");
    await backend.writeRecovery(s().project);
    expect(await files.save()).toBe(true);
    expect(pick).toHaveBeenCalledWith("untitled.msym");
    expect(s()).toMatchObject({ filePath: "untitled.msym", dirty: false });
    const saved = JSON.parse(backend.files.get("untitled.msym")!);
    expect(saved).toMatchObject({ format: 1, app: "0.1.0" });
    expect(saved.components).toHaveLength(1);
    expect(await backend.readRecovery()).toBeNull();
  });

  it("saves again without asking, and Save As always asks", async () => {
    await files.save();
    const pick = vi.spyOn(backend, "pickSavePath");
    s().placePart("basic.capacitor", [100, 0]);
    await files.save();
    expect(pick).not.toHaveBeenCalled();
    await files.saveAs();
    expect(pick).toHaveBeenCalledWith("untitled.msym");
  });

  it("keeps the project dirty when the save dialog is cancelled", async () => {
    vi.spyOn(backend, "pickSavePath").mockResolvedValue(null);
    expect(await files.save()).toBe(false);
    expect(s().dirty).toBe(true);
  });

  it("reports save failures", async () => {
    vi.spyOn(backend, "saveProject").mockRejectedValue("Cannot save x: denied");
    expect(await files.save()).toBe(false);
    expect(notify).toHaveBeenCalledWith("Could not save: Cannot save x: denied");
  });

  it("opens the chosen project", async () => {
    await files.save();
    s().newProject();
    await files.open();
    expect(s().project.components).toHaveLength(1);
    expect(s()).toMatchObject({ filePath: "untitled.msym", dirty: false });
    expect(s().past).toHaveLength(0);
  });

  it("reports open failures and missing parts", async () => {
    vi.spyOn(backend, "pickOpenPath").mockResolvedValueOnce("gone.msym");
    s().markSaved("x.msym");
    await files.open();
    expect(notify).toHaveBeenCalledWith("Could not open: Cannot open gone.msym: not found");

    const project = structuredClone(s().project);
    project.components.push({ ...project.components[0], uid: "c9", part: "rf.antenna" });
    await backend.saveProject("odd.msym", project);
    await files.open();
    expect(notify).toHaveBeenCalledWith("1 part(s) in this project are not in the installed library");
  });

  it("asks before discarding unsaved changes", async () => {
    await files.newFile();
    expect(confirm).toHaveBeenCalled();
    expect(s().project.components).toHaveLength(1);
    confirm.mockReturnValue(true);
    await files.newFile();
    expect(s().project.components).toHaveLength(0);
  });
});
