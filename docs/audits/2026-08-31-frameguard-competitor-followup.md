# FrameGuard competitor attribution follow-up

Date checked: 2026-08-31

## Conclusion

**There is no verified project-level evidence connecting FrameGuard to Action Check or Codex.** The public evidence reliably connects the FrameGuard videos, repository, and live demo to one another. It does not connect those artifacts to this workspace or any particular AI coding product.

FrameGuard should therefore be treated as an independent competitor unless the entrant explicitly confirms otherwise. Similar narration, wording, visual style, or timing is not attribution evidence.

## What the first-party sources establish

- The two public FrameGuard videos—[project overview](https://www.youtube.com/watch?v=1ap31VPnhEM) and [live demonstration](https://www.youtube.com/watch?v=SdxH_-2y9j8)—were published through the same channel on 2026-08-26.
- Both video descriptions identify FrameGuard as a WebMCP Challenge project and link the same [public source repository](https://github.com/488315/frameguard) and [live demo](https://488315.github.io/frameguard/).
- The public repository README describes the same human-in-the-loop visual review product and links the same demo. GitHub's [repository metadata](https://api.github.com/repos/488315/frameguard) records it as a non-fork MIT repository created on 2026-08-26.
- The live URL served a page titled “FrameGuard — Visual change review” when checked.

This proves an artifact chain: **videos → public repository → live demo**. It does not establish who created the project or which development tools were used.

## Checks against Action Check and Codex

- The local project identifies itself as `webmcp-action-assurance-lab` in [`package.json`](../../package.json) and as Action Check in the [`README`](../../README.md). It has no configured Git remote.
- The local repository has four commits, all dated 2026-08-30, at fixed point `134357de3f98feb19f5b6020d16a52f572b11142`; none of those hashes appears in FrameGuard's public [commit history](https://github.com/488315/frameguard/commits/main/). The distinct fixed point is also recorded in the [final worktree review](./2026-08-31-final-worktree-review.md).
- No tracked implementation path or text in this repository contains FrameGuard identifiers. The only local FrameGuard reference found before this report was the question in the superseded [hackathon audit](./2026-08-31-webmcp-hackathon-audit.md#open-question-for-the-entrant).
- [GitHub repository search](https://github.com/search?q=repo%3A488315%2Fframeguard+codex&type=code) returned no `codex` match in FrameGuard, and its README and video descriptions contain no Codex or OpenAI attribution. This is only an absence of disclosure; it cannot prove what tools were or were not used.

## Evidentiary limit and competition treatment

Absence of a cross-link is not proof of non-ownership, and AI-assisted development may leave no public marker. A reliable ownership conclusion would require direct confirmation or a verifiable project-level cross-link.

Until then, use the competitor distinction already identified in the audit: **FrameGuard reviews proposed visual edits before application; Action Check executes registered mutating WebMCP actions and independently tests their resulting effects, including a negative control.**
