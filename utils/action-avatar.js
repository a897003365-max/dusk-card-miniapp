const { GROUPS, STATES, heroGroup } = require('./action-art');

// 同一组件定义用于三个素材包，图片由组件所属包读取。
function definition(group) {
  return {
    properties: { actor: String, state: String, base: String },
    data: { src: '' },
    observers: {
      'actor,state,base': function (actor, state, base) {
        const isFrame = group && GROUPS[group].includes(actor) && STATES.includes(state);
        this.setData({ src: isFrame ? `/package-actors-${group}/assets/${actor}/${state}.png` : base });
      }
    },
    methods: {
      loaded(event) { this.triggerEvent('imageload', { actor: this.data.actor, state: this.data.state, src: this.data.src, ...event.detail }); },
      failed(event) { this.triggerEvent('imageerror', { actor: this.data.actor, state: this.data.state, src: this.data.src, ...event.detail }); }
    }
  };
}

function loadActionPacks(loaders, party) {
  const groups = [...new Set(party.map(member => heroGroup(typeof member === 'string' ? member : member.id)))];
  return Promise.all(groups.filter(Boolean).map(group => loaders[group]()));
}

module.exports = { definition, loadActionPacks };
