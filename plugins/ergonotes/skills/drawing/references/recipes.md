# Worked examples

Each is a complete `draw` call (add `"id": "<note id>"`). All were drawn and checked in the app.

## 1. Architecture with zones

The message: "the client talks to the API; the API reads the cache first, then the database; payments are external".

```json
{
  "title": "Request path",
  "direction": "LR",
  "nodes": [
    { "id": "user", "label": "User", "shape": "ellipse", "color": "violet" },
    { "id": "web", "label": "Web app", "color": "blue" },
    { "id": "api", "label": "API", "color": "blue" },
    { "id": "cache", "label": "Cache", "color": "green" },
    { "id": "db", "label": "Database", "color": "green" },
    { "id": "pay", "label": "Payment provider", "color": "yellow" }
  ],
  "links": [
    { "from": "user", "to": "web" },
    { "from": "web", "to": "api", "label": "HTTPS" },
    { "from": "api", "to": "cache", "label": "1st" },
    { "from": "api", "to": "db", "label": "miss" },
    { "from": "api", "to": "pay", "style": "dashed" }
  ],
  "zones": [{ "id": "backend", "label": "Our backend", "nodes": ["api", "cache", "db"], "color": "gray" }]
}
```

If the payment provider lands inside the zone's box, the tool warns: give the zone's nodes explicitly and, if needed, put the
provider at a fixed `x`/`y` to the right.

## 2. Flowchart with a decision

```json
{
  "direction": "TB",
  "nodes": [
    { "id": "start", "label": "New capture", "shape": "ellipse", "color": "violet" },
    { "id": "task", "label": "Is it a task?", "shape": "diamond", "color": "yellow" },
    { "id": "todo", "label": "Add to a note as a checklist line", "color": "green" },
    { "id": "idea", "label": "Keep as a note in the Inbox", "color": "blue" },
    { "id": "done", "label": "Triage later", "shape": "ellipse", "color": "gray" }
  ],
  "links": [
    { "from": "start", "to": "task" },
    { "from": "task", "to": "todo", "label": "yes" },
    { "from": "task", "to": "idea", "label": "no" },
    { "from": "todo", "to": "done" },
    { "from": "idea", "to": "done" }
  ]
}
```

## 3. A pipeline with a loop

```json
{
  "direction": "LR",
  "nodes": [
    { "id": "plan", "label": "Plan", "color": "blue" },
    { "id": "build", "label": "Build", "color": "blue" },
    { "id": "test", "label": "Test", "color": "orange" },
    { "id": "ship", "label": "Ship", "color": "green" }
  ],
  "links": [
    { "from": "plan", "to": "build" },
    { "from": "build", "to": "test" },
    { "from": "test", "to": "ship", "label": "pass" },
    { "from": "test", "to": "build", "label": "fail", "style": "dashed", "color": "red" }
  ]
}
```

## 4. Mind map by hand

A centre and branches placed on a fan, since a mind map is not a flow. Coordinates in pixels.

```json
{
  "nodes": [
    { "id": "c", "label": "Writing a book", "shape": "ellipse", "color": "violet", "x": 400, "y": 240, "w": 220, "h": 100 },
    { "id": "a", "label": "Research", "color": "blue", "x": 60, "y": 60 },
    { "id": "b", "label": "Outline", "color": "blue", "x": 60, "y": 400 },
    { "id": "d", "label": "Drafting", "color": "green", "x": 780, "y": 60 },
    { "id": "e", "label": "Editing", "color": "green", "x": 780, "y": 400 }
  ],
  "links": [
    { "from": "c", "to": "a", "arrow": "none" },
    { "from": "c", "to": "b", "arrow": "none" },
    { "from": "c", "to": "d", "arrow": "none" },
    { "from": "c", "to": "e", "arrow": "none" }
  ]
}
```

## 5. A timeline

```json
{
  "title": "Project phases",
  "direction": "LR",
  "nodes": [
    { "id": "t1", "label": "Oct\nDiscovery", "color": "blue" },
    { "id": "t2", "label": "Nov\nDesign", "color": "blue" },
    { "id": "t3", "label": "Dec\nBuild", "color": "teal" },
    { "id": "t4", "label": "Jan\nLaunch", "color": "green" }
  ],
  "links": [
    { "from": "t1", "to": "t2", "arrow": "none" },
    { "from": "t2", "to": "t3", "arrow": "none" },
    { "from": "t3", "to": "t4", "arrow": "none" }
  ]
}
```

## 6. A comparison (two zones, same structure)

```json
{
  "nodes": [
    { "id": "a1", "label": "Plain files", "color": "green", "x": 0, "y": 0, "w": 220, "h": 70 },
    { "id": "a2", "label": "Works offline", "color": "green", "x": 0, "y": 110, "w": 220, "h": 70 },
    { "id": "b1", "label": "Database", "color": "orange", "x": 420, "y": 0, "w": 220, "h": 70 },
    { "id": "b2", "label": "Needs the app", "color": "orange", "x": 420, "y": 110, "w": 220, "h": 70 }
  ],
  "zones": [
    { "id": "left", "label": "Folder of Markdown", "nodes": ["a1", "a2"], "color": "green" },
    { "id": "right", "label": "Proprietary store", "nodes": ["b1", "b2"], "color": "orange" }
  ]
}
```
