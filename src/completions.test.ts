import { getCompletionScript } from "./completions.js";

describe("completions", () => {
  describe("getCompletionScript", () => {
    it("should return the BASH completion script", () => {
      const script = getCompletionScript("bash");
      expect(script).toContain("# x CLI completion script for Bash");
      expect(script).toContain("commands=\"tweet home login logout whoami completion setup\"");
    });

    it("should return the ZSH completion script", () => {
      const script = getCompletionScript("zsh");
      expect(script).toContain("# x CLI completion script for Zsh");
      expect(script).toContain("'home:View your home timeline (login required)'");
    });

    it("should return the FISH completion script", () => {
      const script = getCompletionScript("fish");
      expect(script).toContain("# x CLI completion script for Fish");
      expect(script).toContain(
        "complete -c x -n \"__fish_use_subcommand\" -a \"home\" -d \"View your home timeline (login required)\""
      );
    });

    it("should throw an error for an unknown shell", () => {
      expect(() => getCompletionScript("unknown")).toThrow(
        "Unknown shell: unknown. Supported shells: bash, zsh, fish"
      );
    });
  });
});
