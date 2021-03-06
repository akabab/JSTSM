{% if header -%}
//
//  {{ modelName }}.swift
//  {{ header.projectName }}
//
//  Created by {{ header.author }} on {{ header.now }}.
//  Copyright © {{ header.copyright }}. All rights reserved.
//
{% endif -%}
//
//  This file has been generated, modify it at your own risks!
//

{{ "struct" if isStruct else "class" }} {{ modelName }}{{ ": " if extends }}
{%- if extends -%}
  {%- for ext in extends -%}
    {{ ", " if not loop.first }}{{ ext }}
  {%- endfor -%}
{%- endif %} {

  // MARK: - Properties
{% for p in properties %}
  var {{ p.key }}: {{ p.type }}{{ "?" if not p.required }}
{% endfor %}

  // MARK: - Inits

  {{"required " if not isStruct }}init?(json: [String: AnyObject]) {
  {% for p in properties %}
    {%- if p.isRef %}
      {%- if p.required %}
    self.{{ p.key }} = {{ p.type }}(json: json["{{ p.key }}"] as! [String: AnyObject])!
      {%- else %}
    if let {{ p.key }} = json["{{ p.key }}"] as? [String: AnyObject] {
      self.{{ p.key }} = {{ p.type }}(json: {{ p.key }})!
    }
      {%- endif %}
    {%- else %}
    self.{{ p.key }} = json["{{ p.key }}"] as{{ "!" if p.required else "?" }} {{ p.type }}
    {%- endif %}
  {% endfor %}
  {%- if hasSuperClass %}
    super.init(json: json)
  {% endif %}
  }

}
