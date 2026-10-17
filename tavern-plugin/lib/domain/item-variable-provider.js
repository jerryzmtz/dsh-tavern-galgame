// private fork: inventory is a read-only projection, not a second MVU store.
import {itemWidgetSettings} from './item-widget.js'
export const itemVariableProvider = {
  id: 'items', label: '物品',
  slots(context = {}) {
    return [{
      target: {kind:'items', slot:'inventory'}, label:'物品列表',
      active:itemWidgetSettings(context).enabled, valueType:'array', default:[],
      fieldMapping: {
        name:{label:'名称', valueType:'string', required:true},
        count:{label:'数量', valueType:'number', required:true},
        category:{label:'分类', valueType:'string', required:false},
        description:{label:'说明', valueType:'string', required:false},
        id:{label:'稳定标识', valueType:'string', required:false},
        owner:{label:'持有人', valueType:'string', required:false},
      },
      guessHints:{keywords:['物品','背包','inventory','items'], preferredParents:['玩家','主角','player']},
    }]
  },
}
