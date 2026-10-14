# Items are stored flat by UUID; the folder tree is metadata

On the Store and on disk Items are addressed by their immutable UUID, and a Note's place in the tree is its `parent` field. Renaming or moving is therefore a one-field change with no path conflicts, and Links never break because they reference IDs. The Store contents are encrypted anyway, so readable file names would carry no value there. The cost is that the on-disk tree is not a literal mirror of what the person sees; on Windows the local folder is still a plain Markdown vault openable in other editors.
