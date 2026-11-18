import { describe, expect, it } from "vitest";
import { chatCommandSchema, chatQuerySchema, mergeChat, type ChatMessage } from "./connected-chat";
import { accountRedirect } from "./identity";

const order = "bc413da8-4bea-400c-889c-a84703e08a70";
describe("connected chat boundary", () => {
  it("binds exact commands and bounded cursors", () => {
    expect(chatCommandSchema.parse({ action: "send", order, clientId: order, body: "  Halo  " })).toMatchObject({ body: "Halo" });
    expect(chatCommandSchema.safeParse({ action: "send", order, clientId: order, body: " ", senderId: order }).success).toBe(false);
    expect(chatCommandSchema.safeParse({ action: "send", order, clientId: order, body: " ".repeat(1001) + "a" }).success).toBe(false);
    expect(chatQuerySchema.safeParse({ order, before: "3", after: "0" }).success).toBe(false);
    expect(chatQuerySchema.safeParse({ order, after: "9007199254740992" }).success).toBe(false);
    expect(chatCommandSchema.safeParse({ action: "read", order, sequence: -1 }).success).toBe(false);
  });
  it("deduplicates reordered catch-up and only allows internal chat destinations", () => {
    const first = { id: "a", sequence: 1 } as ChatMessage;
    const second = { id: "b", sequence: 2 } as ChatMessage;
    expect(mergeChat([second], [first, second])).toEqual([first, second]);
    expect(accountRedirect(`/chat/${order}`)).toBe(`/chat/${order}`);
    expect(accountRedirect(`/chat/${order}?next=https://bad.invalid`)).toBe("/account");
    expect(accountRedirect("//bad.invalid/chat")).toBe("/account");
  });
});
