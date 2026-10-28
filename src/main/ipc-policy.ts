export function allowDesktopRequest(input: {
  senderId: number; expectedSenderId: number; isMainFrame: boolean;
  frameUrl: string; expectedUrl: string; args: unknown[];
}): boolean {
  return input.senderId === input.expectedSenderId && input.isMainFrame
    && input.frameUrl === input.expectedUrl && input.args.length === 0;
}
