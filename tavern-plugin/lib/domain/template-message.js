const templateFields=['variables_initialized','is_ejs_processed','template_display','template_rendered']
export function projectTemplateMessage(message){
 return {mes:message.message,is_user:message.role==='user',is_system:message.role==='system',
  name:message.name||'',swipe_id:message.swipe_id,swipes:structuredClone(message.swipes),
  variables:message.swipes_data.map(value=>value && typeof value==='object' && !Array.isArray(value)?structuredClone(value):{}),
  ...Object.fromEntries(templateFields.filter(key=>Object.hasOwn(message.pluginData,key)).map(key=>[key,structuredClone(message.pluginData[key])]))}
}
