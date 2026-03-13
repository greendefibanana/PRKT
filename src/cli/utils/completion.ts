const TOP_LEVEL_COMMANDS = [
  "wallet",
  "token",
  "policy",
  "agent",
  "monitor",
  "demo",
  "audit",
  "config",
  "doctor",
  "completion"
];

export function completionWords(): string {
  return TOP_LEVEL_COMMANDS.join(" ");
}

export function buildBashCompletion(): string {
  return `# bash completion for prkt
_prkt_completion() {
  local cur cword
  cur="\${COMP_WORDS[COMP_CWORD]}"
  cword=$COMP_CWORD
  local commands="${completionWords()}"
  if [[ $cword -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
    return
  fi
}
complete -F _prkt_completion prkt
`;
}

export function buildZshCompletion(): string {
  return `#compdef prkt
_prkt() {
  local -a commands
  commands=(${completionWords()})
  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi
}
compdef _prkt prkt
`;
}

export function buildPowerShellCompletion(): string {
  return `Register-ArgumentCompleter -Native -CommandName prkt -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $commands = @(${completionWords()
    .split(" ")
    .map((word) => `'${word}'`)
    .join(", ")})
  $commands | Where-Object { $_ -like \"$wordToComplete*\" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
  }
}
`;
}
