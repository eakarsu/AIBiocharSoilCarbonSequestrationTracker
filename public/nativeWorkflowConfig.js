window.nativeWorkflowConfig = {
  "title": "Biochar Soil Carbon Sequestration Tracker",
  "features": [
    {
      "id": "analyze-sequestration",
      "endpoint": "/ai/analyze-sequestration",
      "title": "Analyze sequestration",
      "description": "Illustrative examples require source review. Native records, measurements, signatures and publication or approval controls retain their actual workflow.",
      "fields": [
        {
          "key": "field_id",
          "type": "text",
          "required": true,
          "label": "Field id",
          "presets": [
            "",
            "",
            ""
          ],
          "manual": true,
          "resource": "fields"
        }
      ],
      "source": {
        "file": "src/routes/ai.js",
        "line": 15
      }
    },
    {
      "id": "soil-health",
      "endpoint": "/ai/soil-health",
      "title": "Soil health",
      "description": "Illustrative examples require source review. Native records, measurements, signatures and publication or approval controls retain their actual workflow.",
      "fields": [
        {
          "key": "field_id",
          "type": "text",
          "required": true,
          "label": "Field id",
          "presets": [
            "",
            "",
            ""
          ],
          "manual": true,
          "resource": "fields"
        }
      ],
      "source": {
        "file": "src/routes/ai.js",
        "line": 41
      }
    },
    {
      "id": "recommendations",
      "endpoint": "/ai/recommendations",
      "title": "Recommendations",
      "description": "Illustrative examples require source review. Native records, measurements, signatures and publication or approval controls retain their actual workflow.",
      "fields": [
        {
          "key": "field_id",
          "type": "text",
          "required": true,
          "label": "Field id",
          "presets": [
            "",
            "",
            ""
          ],
          "manual": true,
          "resource": "fields"
        }
      ],
      "source": {
        "file": "src/routes/ai.js",
        "line": 69
      }
    },
    {
      "id": "validate-report",
      "endpoint": "/ai/validate-report",
      "title": "Validate report",
      "description": "Illustrative examples require source review. Native records, measurements, signatures and publication or approval controls retain their actual workflow.",
      "fields": [
        {
          "key": "report_id",
          "type": "text",
          "required": true,
          "label": "Report id",
          "presets": [
            "",
            "",
            ""
          ],
          "manual": true,
          "resource": "carbon-reports"
        }
      ],
      "source": {
        "file": "src/routes/ai.js",
        "line": 95
      }
    },
    {
      "id": "portfolio",
      "endpoint": "/ai/portfolio",
      "title": "Portfolio",
      "description": "Illustrative examples require source review. Native records, measurements, signatures and publication or approval controls retain their actual workflow.",
      "fields": [],
      "source": {
        "file": "src/routes/ai.js",
        "line": 124
      }
    },
    {
      "id": "mrv-readiness",
      "endpoint": "/runtime-ai/mrv-readiness",
      "title": "Mrv readiness",
      "description": "Illustrative examples require source review. Native records, measurements, signatures and publication or approval controls retain their actual workflow.",
      "fields": [
        {
          "key": "prompt",
          "type": "text",
          "required": true,
          "label": "Prompt",
          "presets": [
            "Summarize evidence readiness for a 12-hectare temperate cropland biochar project using orchard-pruning feedstock. List the source documents needed for baseline soil carbon, pyrolysis conditions, application logs, and chain of custody. Flag missing evidence and do not claim certification.",
            "Draft a field-team checklist for measuring and documenting a biochar application on a 5-hectare trial plot. Cover batch mass, carbon content, GPS boundaries, soil sampling dates, photos, and responsible reviewers. Distinguish verified observations from assumptions.",
            "Review the MRV evidence gaps for a farm that has lab results and application dates but no independent verifier statement yet. Prioritize follow-up actions, uncertainty checks, and records needed before any registry submission. Do not estimate credits without measurements."
          ],
          "manual": false
        }
      ],
      "source": {
        "file": "src/routes/runtimeAi.js",
        "line": 10
      }
    }
  ],
  "resources": [
    {
      "key": "fields",
      "endpoint": "/fields",
      "label": "Fields",
      "fields": [],
      "delete": false,
      "source": "Existing authenticated resource API; record mutations remain in native governed screens."
    },
    {
      "key": "carbon-reports",
      "endpoint": "/carbon-reports",
      "label": "Carbon reports",
      "fields": [],
      "delete": false,
      "source": "Existing authenticated resource API; record mutations remain in native governed screens."
    }
  ]
};
