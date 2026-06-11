use std::env;
use std::ffi::OsString;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

const MACOS_SEATBELT_BASE_POLICY: &str = include_str!("seatbelt_base_policy.sbpl");
const MACOS_SEATBELT_NETWORK_POLICY: &str = include_str!("seatbelt_network_policy.sbpl");
const MACOS_RESTRICTED_READ_ONLY_PLATFORM_DEFAULTS: &str =
    include_str!("restricted_read_only_platform_defaults.sbpl");
const MACOS_PATH_TO_SEATBELT_EXECUTABLE: &str = "/usr/bin/sandbox-exec";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Access {
    Read,
    Write,
    None,
}

impl Access {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "read" => Ok(Self::Read),
            "write" => Ok(Self::Write),
            "none" => Ok(Self::None),
            _ => Err(format!("unknown filesystem access mode: {value}")),
        }
    }

    fn can_read(self) -> bool {
        matches!(self, Self::Read | Self::Write)
    }

    fn can_write(self) -> bool {
        matches!(self, Self::Write)
    }

    fn tie_break_precedence(self) -> usize {
        match self {
            Self::Read => 1,
            Self::Write => 2,
            Self::None => 3,
        }
    }
}

#[derive(Clone, Debug)]
struct Entry {
    access: Access,
    path: PathBuf,
    raw_path: PathBuf,
    protected_metadata_names: Vec<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FileSystemKind {
    Restricted,
    Unrestricted,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum NetworkPolicy {
    Enabled,
    Restricted,
}

struct HelperArgs {
    check_access: Option<CheckAccess>,
    cwd: PathBuf,
    fs_kind: FileSystemKind,
    include_platform_defaults: bool,
    network: NetworkPolicy,
    entries: Vec<Entry>,
    command: Vec<OsString>,
}

struct CheckAccess {
    access: Access,
    path: PathBuf,
}

struct AccessRoot {
    root: PathBuf,
    excluded_subpaths: Vec<PathBuf>,
    protected_metadata_names: Vec<String>,
}

struct SeatbeltProfile {
    profile: String,
    parameters: Vec<(String, String)>,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("svvy-sandbox-helper: {error}");
        std::process::exit(125);
    }
}

fn run() -> Result<(), String> {
    let args = parse_args(env::args_os().skip(1).collect())?;
    if let Some(check) = &args.check_access {
        let allowed = match check.access {
            Access::Read => can_read_path(&args, &check.path),
            Access::Write => can_write_path(&args, &check.path),
            Access::None => resolve_access(&args, &check.path) == Access::None,
        };
        println!("{}", if allowed { "allowed" } else { "denied" });
        return if allowed {
            Ok(())
        } else {
            Err(format!(
                "{access:?} access denied for {path}",
                access = check.access,
                path = check.path.display()
            ))
        };
    }
    if args.fs_kind == FileSystemKind::Unrestricted && args.network == NetworkPolicy::Enabled {
        return exec_command(&args.command);
    }
    if cfg!(not(target_os = "macos")) {
        return Err(
            "managed sandboxing through svvy-sandbox-helper is only available on macOS".into(),
        );
    }
    if !Path::new(MACOS_PATH_TO_SEATBELT_EXECUTABLE).exists() {
        return Err("missing fixed /usr/bin/sandbox-exec executable".into());
    }
    let seatbelt = build_seatbelt_profile(&args)?;
    let mut command = Command::new(MACOS_PATH_TO_SEATBELT_EXECUTABLE);
    command.current_dir(&args.cwd);
    command.arg("-p").arg(seatbelt.profile);
    for (name, value) in seatbelt.parameters {
        command.arg(format!("-D{name}={value}"));
    }
    command.arg("--");
    command.args(&args.command);
    let error = command.exec();
    Err(format!("failed to exec sandbox-exec: {error}"))
}

fn exec_command(command_argv: &[OsString]) -> Result<(), String> {
    let Some(program) = command_argv.first() else {
        return Err("missing command after --".into());
    };
    let mut command = Command::new(program);
    command.args(&command_argv[1..]);
    let error = command.exec();
    Err(format!("failed to exec command: {error}"))
}

fn parse_args(args: Vec<OsString>) -> Result<HelperArgs, String> {
    let mut cwd: Option<PathBuf> = None;
    let mut fs_kind = FileSystemKind::Restricted;
    let mut include_platform_defaults = false;
    let mut network = NetworkPolicy::Restricted;
    let mut entries = Vec::new();
    let mut check_access = None;
    let mut index = 0;
    while index < args.len() {
        let token = args[index].to_string_lossy();
        if token == "--" {
            let command = args[index + 1..].to_vec();
            if command.is_empty() {
                return Err("missing command after --".into());
            }
            return Ok(HelperArgs {
                check_access,
                cwd: normalize_required_absolute_path(cwd.ok_or("missing --cwd")?.as_path())?,
                fs_kind,
                include_platform_defaults,
                network,
                entries,
                command,
            });
        }
        match token.as_ref() {
            "--cwd" => {
                index += 1;
                cwd = Some(PathBuf::from(required_arg(&args, index, "--cwd")?));
            }
            "--fs-kind" => {
                index += 1;
                fs_kind = match required_arg(&args, index, "--fs-kind")?.as_str() {
                    "restricted" => FileSystemKind::Restricted,
                    "unrestricted" => FileSystemKind::Unrestricted,
                    value => return Err(format!("unknown filesystem kind: {value}")),
                };
            }
            "--network" => {
                index += 1;
                network = match required_arg(&args, index, "--network")?.as_str() {
                    "enabled" => NetworkPolicy::Enabled,
                    "restricted" => NetworkPolicy::Restricted,
                    value => return Err(format!("unknown network policy: {value}")),
                };
            }
            "--include-platform-defaults" => {
                include_platform_defaults = true;
            }
            "--entry" => {
                let access = Access::parse(&required_arg(&args, index + 1, "--entry access")?)?;
                let raw_path = required_absolute_path(Path::new(&required_arg(
                    &args,
                    index + 2,
                    "--entry path",
                )?))?;
                let path = normalize_path_for_sandbox(&raw_path);
                let protected_metadata_names = required_arg(&args, index + 3, "--entry protected")?
                    .split(',')
                    .filter(|name| !name.is_empty())
                    .map(ToOwned::to_owned)
                    .collect();
                entries.push(Entry {
                    access,
                    path,
                    raw_path,
                    protected_metadata_names,
                });
                index += 3;
            }
            "--check-access" => {
                let access =
                    Access::parse(&required_arg(&args, index + 1, "--check-access access")?)?;
                let path = required_absolute_path(Path::new(&required_arg(
                    &args,
                    index + 2,
                    "--check-access path",
                )?))?;
                check_access = Some(CheckAccess { access, path });
                index += 2;
            }
            _ => return Err(format!("unknown argument before --: {token}")),
        }
        index += 1;
    }
    Err("missing -- command separator".into())
}

fn required_arg(args: &[OsString], index: usize, name: &str) -> Result<String, String> {
    args.get(index)
        .map(|value| value.to_string_lossy().to_string())
        .ok_or_else(|| format!("missing value for {name}"))
}

fn required_absolute_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err(format!(
            "sandbox paths must be absolute: {}",
            path.display()
        ));
    }
    Ok(path.to_path_buf())
}

fn normalize_required_absolute_path(path: &Path) -> Result<PathBuf, String> {
    Ok(normalize_path_for_sandbox(&required_absolute_path(path)?))
}

fn normalize_path_for_sandbox(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return canonical;
    }

    let mut suffix = Vec::new();
    let mut current = path;
    while !current.exists() {
        let Some(file_name) = current.file_name() else {
            break;
        };
        suffix.push(file_name.to_os_string());
        let Some(parent) = current.parent() else {
            break;
        };
        current = parent;
    }

    if let Ok(mut canonical_base) = current.canonicalize() {
        for component in suffix.iter().rev() {
            canonical_base.push(component);
        }
        canonical_base
    } else {
        path.to_path_buf()
    }
}

fn build_seatbelt_profile(args: &HelperArgs) -> Result<SeatbeltProfile, String> {
    let mut parameters = Vec::new();
    let file_read_policy = if has_full_disk_read_access(args) {
        if unreadable_roots(args).is_empty() {
            "; allow read-only file operations\n(allow file-read*)".to_string()
        } else {
            let policy = build_seatbelt_access_policy(
                "file-read*",
                "READ_ROOT",
                vec![AccessRoot {
                    root: PathBuf::from("/"),
                    excluded_subpaths: unreadable_roots(args),
                    protected_metadata_names: Vec::new(),
                }],
                &mut parameters,
            );
            format!("; allow read-only file operations\n{policy}")
        }
    } else {
        let policy = build_seatbelt_access_policy(
            "file-read*",
            "READ_ROOT",
            readable_roots(args)
                .into_iter()
                .map(|root| AccessRoot {
                    excluded_subpaths: unreadable_roots(args)
                        .into_iter()
                        .filter(|path| path_starts_with(path, &root))
                        .collect(),
                    protected_metadata_names: Vec::new(),
                    root,
                })
                .collect(),
            &mut parameters,
        );
        if policy.is_empty() {
            return Err("restricted filesystem policy has no readable roots".into());
        }
        format!("; allow read-only file operations\n{policy}")
    };
    let file_write_policy = if args.fs_kind == FileSystemKind::Unrestricted {
        r#"(allow file-write* (regex #"^/"))"#.to_string()
    } else {
        let writable = writable_roots(args)
            .into_iter()
            .map(|root| AccessRoot {
                protected_metadata_names: protected_metadata_names_for_writable_root(args, &root),
                excluded_subpaths: read_only_subpaths_for_writable_root(args, &root),
                root,
            })
            .collect();
        build_seatbelt_access_policy("file-write*", "WRITE_ROOT", writable, &mut parameters)
    };
    let network_policy = match args.network {
        NetworkPolicy::Enabled => format!(
            "{MACOS_SEATBELT_NETWORK_POLICY}\n(allow network-outbound)\n(allow network-inbound)"
        ),
        NetworkPolicy::Restricted => String::new(),
    };
    let mut sections = vec![
        MACOS_SEATBELT_BASE_POLICY,
        &file_read_policy,
        &file_write_policy,
        &network_policy,
    ];
    if args.include_platform_defaults {
        sections.push(MACOS_RESTRICTED_READ_ONLY_PLATFORM_DEFAULTS);
    }
    Ok(SeatbeltProfile {
        profile: sections.join("\n"),
        parameters,
    })
}

fn build_seatbelt_access_policy(
    action: &str,
    parameter_prefix: &str,
    roots: Vec<AccessRoot>,
    parameters: &mut Vec<(String, String)>,
) -> String {
    let mut policy_components = Vec::new();
    for (root_index, access_root) in roots.into_iter().enumerate() {
        let root = normalize_path_for_sandbox(&access_root.root);
        let root_param = format!("{parameter_prefix}_{root_index}");
        parameters.push((root_param.clone(), root.to_string_lossy().to_string()));
        let mut require_parts = vec![format!(r#"(subpath (param "{root_param}"))"#)];
        for (excluded_index, excluded) in access_root.excluded_subpaths.into_iter().enumerate() {
            let excluded = normalize_path_for_sandbox(&excluded);
            let excluded_param =
                format!("{parameter_prefix}_{root_index}_EXCLUDED_{excluded_index}");
            parameters.push((
                excluded_param.clone(),
                excluded.to_string_lossy().to_string(),
            ));
            require_parts.push(format!(
                r#"(require-not (literal (param "{excluded_param}")))"#
            ));
            require_parts.push(format!(
                r#"(require-not (subpath (param "{excluded_param}")))"#
            ));
        }
        for metadata_name in access_root.protected_metadata_names {
            let regex = seatbelt_protected_metadata_name_regex(&root, &metadata_name);
            require_parts.push(format!(r#"(require-not (regex #"{regex}"))"#));
        }
        policy_components.push(format!("(require-all {} )", require_parts.join(" ")));
    }
    if policy_components.is_empty() {
        String::new()
    } else {
        format!("(allow {action}\n{}\n)", policy_components.join(" "))
    }
}

fn seatbelt_protected_metadata_name_regex(root: &Path, name: &str) -> String {
    let mut root = regex_escape(&root.to_string_lossy());
    while root.len() > 1 && root.ends_with('/') {
        root.pop();
    }
    let name = regex_escape(name);
    if root == "/" {
        format!(r#"^/{name}(/.*)?$"#)
    } else {
        format!(r#"^{root}/{name}(/.*)?$"#)
    }
}

fn regex_escape(value: &str) -> String {
    let mut output = String::new();
    for ch in value.chars() {
        if matches!(
            ch,
            '.' | '+' | '*' | '?' | '(' | ')' | '|' | '[' | ']' | '{' | '}' | '^' | '$' | '\\'
        ) {
            output.push('\\');
        }
        output.push(ch);
    }
    output.replace('"', "\\\"")
}

fn resolve_access(args: &HelperArgs, path: &Path) -> Access {
    if args.fs_kind == FileSystemKind::Unrestricted {
        return Access::Write;
    }
    let target = normalize_path_for_sandbox(path);
    args.entries
        .iter()
        .filter(|entry| path_starts_with(&target, &entry.path))
        .max_by(|left, right| {
            path_specificity(&left.path)
                .cmp(&path_specificity(&right.path))
                .then(
                    left.access
                        .tie_break_precedence()
                        .cmp(&right.access.tie_break_precedence()),
                )
        })
        .map(|entry| entry.access)
        .unwrap_or(Access::None)
}

fn can_write_path(args: &HelperArgs, path: &Path) -> bool {
    resolve_access(args, path).can_write() && !is_protected_metadata_write_denied(args, path)
}

fn can_read_path(args: &HelperArgs, path: &Path) -> bool {
    resolve_access(args, path).can_read()
}

fn has_full_disk_read_access(args: &HelperArgs) -> bool {
    can_read_path(args, Path::new("/"))
}

fn readable_roots(args: &HelperArgs) -> Vec<PathBuf> {
    roots_for(args, |access| access.can_read())
}

fn writable_roots(args: &HelperArgs) -> Vec<PathBuf> {
    roots_for(args, |access| access.can_write())
        .into_iter()
        .filter(|path| can_write_path(args, path))
        .collect()
}

fn roots_for(args: &HelperArgs, predicate: impl Fn(Access) -> bool) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = args
        .entries
        .iter()
        .filter(|entry| predicate(entry.access))
        .filter(|entry| resolve_access(args, &entry.path) == entry.access)
        .map(|entry| entry.path.clone())
        .collect();
    roots.sort();
    roots.dedup();
    roots
}

fn unreadable_roots(args: &HelperArgs) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = args
        .entries
        .iter()
        .filter(|entry| entry.access == Access::None)
        .filter(|entry| resolve_access(args, &entry.path) == Access::None)
        .map(|entry| entry.path.clone())
        .collect();
    roots.sort();
    roots.dedup();
    roots
}

fn read_only_subpaths_for_writable_root(args: &HelperArgs, root: &Path) -> Vec<PathBuf> {
    args.entries
        .iter()
        .filter(|entry| entry.access != Access::Write)
        .filter(|entry| path_starts_with(&entry.path, root))
        .filter(|entry| !can_write_path(args, &entry.path))
        .map(|entry| entry.path.clone())
        .collect()
}

fn protected_metadata_names_for_writable_root(args: &HelperArgs, root: &Path) -> Vec<String> {
    let mut names = args
        .entries
        .iter()
        .filter(|entry| entry.access == Access::Write && entry.path == root)
        .flat_map(|entry| entry.protected_metadata_names.clone())
        .collect::<Vec<_>>();
    for name in [".git", ".agents", ".codex"] {
        if names.iter().any(|existing| existing == name) {
            continue;
        }
        let path = root.join(name);
        if !can_write_path(args, &path) {
            names.push(name.to_string());
        }
    }
    names.sort();
    names.dedup();
    names
}

fn is_protected_metadata_write_denied(args: &HelperArgs, path: &Path) -> bool {
    if args.fs_kind == FileSystemKind::Unrestricted {
        return false;
    }
    let target = normalize_path_for_sandbox(path);
    let raw_target = path.to_path_buf();
    for entry in args
        .entries
        .iter()
        .filter(|entry| entry.access == Access::Write)
    {
        for name in &entry.protected_metadata_names {
            let metadata_root = entry.raw_path.join(name);
            if !path_starts_with(&raw_target, &metadata_root) {
                continue;
            }
            if has_explicit_metadata_write(
                args,
                &entry.raw_path,
                &metadata_root,
                &raw_target,
                &target,
            ) {
                continue;
            }
            return true;
        }
    }
    false
}

fn has_explicit_metadata_write(
    args: &HelperArgs,
    broad_writable_root: &Path,
    metadata_root: &Path,
    raw_target: &Path,
    normalized_target: &Path,
) -> bool {
    args.entries.iter().any(|entry| {
        entry.access == Access::Write
            && entry.raw_path != broad_writable_root
            && path_starts_with(&entry.raw_path, metadata_root)
            && (path_starts_with(raw_target, &entry.raw_path)
                || path_starts_with(normalized_target, &entry.path))
    })
}

fn path_specificity(path: &Path) -> usize {
    path.components().count()
}

fn path_starts_with(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}
