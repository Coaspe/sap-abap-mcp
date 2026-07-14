export const DEVELOPMENT_PARITY_FIXTURES = {
  replHealth: {
    status: "ok",
    version: "1",
    user: "SANITIZED_USER",
    system: "D01",
    client: "100",
    production: false
  },
  replExecution: {
    success: true,
    output: "42\n",
    error: "",
    runtime_ms: 5
  },
  completionElement: {
    name: "WRITE",
    type: "KEYWORD",
    href: "",
    doc: "Writes output",
    components: []
  },
  documentation: "<p>WRITE documentation</p>",
  typeHierarchy: [{
    hasDefOrImpl: true,
    uri: "/sap/bc/adt/oo/classes/zcl_parent",
    line: 1,
    character: 0,
    type: "CLAS/OC",
    name: "ZCL_PARENT",
    parentUri: "",
    description: "Parent"
  }],
  components: {
    "adtcore:name": "ZCL_DEMO",
    "adtcore:type": "CLAS/OC",
    links: [],
    visibility: "public",
    "xml:base": "",
    components: [{
      "adtcore:name": "RUN",
      "adtcore:type": "CLAS/OM",
      links: [],
      visibility: "public",
      "xml:base": "",
      components: []
    }]
  },
  activationPartial: {
    success: false,
    messages: [{
      objDescr: "ZCL_SECOND",
      type: "E",
      line: 1,
      href: "/sap/bc/adt/oo/classes/zcl_second",
      forceSupported: false,
      shortText: "Activation failed"
    }]
  }
}
