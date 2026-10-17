fn main() {
    // The icons are compiled into the Windows executable by this script; without this line cargo
    // reuses the old resource when only the icons changed.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
