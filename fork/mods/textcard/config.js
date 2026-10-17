// Register with the mod-config owner when its host integration lands; no parallel resolver.
export const configSchema={fields:[{key:'intensity',label:'\u5f3a\u5ea6',valueType:'string',default:'standard',scope:'default+card',ui:{control:'choice',choices:[
  {value:'restrained',label:'\u514b\u5236'}, {value:'standard',label:'\u6807\u51c6'}, {value:'intense',label:'\u6d53\u70c8'},
]}}]}
