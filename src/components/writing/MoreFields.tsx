import type { Volume } from '../../types'

export default function MoreFields({ vol }: { vol: Volume }) {
  return (
    <details className="group">
      <summary className="text-xs font-medium text-text-secondary cursor-pointer hover:text-text-main select-none py-0.5">
        ⚙ 更多字段（节奏/伏笔/里程碑/冲突）
      </summary>
      <div className="mt-1 space-y-1 pl-2 border-l-2 border-border text-xs text-text-secondary">
        {vol.connection_prev && <p>⬆️ 承上：{vol.connection_prev}</p>}
        {vol.connection_next && <p>⬇️ 启下：{vol.connection_next}</p>}
        {vol.word_count_target && <p>📊 目标：{vol.word_count_target.toLocaleString()} 字</p>}
        {vol.pacing_design && <p>🎵 节奏：{vol.pacing_design}</p>}
        {vol.emotional_cadence && <p>🎭 情绪：{vol.emotional_cadence}</p>}
        {vol.foreshadowing_plant?.length ? <p>🪝 新埋：{vol.foreshadowing_plant.join('、')}</p> : null}
        {vol.foreshadowing_payoff?.length ? <p>✅ 回收：{vol.foreshadowing_payoff.join('、')}</p> : null}
        {vol.foreshadowing_advance && <p>🔗 推进：{vol.foreshadowing_advance}</p>}
        {vol.foreshadowing && <p>🪝 伏笔：{vol.foreshadowing}</p>}
        {vol.foreshadowing_planted?.length ? <p>🪝 新伏笔：{vol.foreshadowing_planted.join('、')}</p> : null}
        {vol.foreshadowing_recovered?.length ? <p>✅ 回收伏笔：{vol.foreshadowing_recovered.join('、')}</p> : null}
        {vol.nodes?.length ? (
          <div>
            <p className="font-medium mt-1 mb-0.5">🎬 八节点结构</p>
            {vol.nodes.map((n, i) => (
              <div key={i} className="bg-bg-secondary rounded px-1.5 py-1 mb-0.5">
                <div className="flex items-center gap-1">
                  <span className="font-medium text-text-main">{n.name}</span>
                  <span className="text-text-placeholder">{n.chapter_segment}</span>
                  <span className={`text-xxs px-1 rounded ${n.pacing === '快' || n.pacing === '极快' ? 'bg-danger/10 text-danger' : n.pacing === '慢' ? 'bg-success/10 text-success' : 'bg-gray-100 text-text-secondary'}`}>{n.pacing}</span>
                </div>
                <p className="mt-0.5">{n.task}</p>
                {n.disasm_ref && n.disasm_ref !== '无' && <p className="text-primary/70 text-xxs">🔗 {n.disasm_ref}</p>}
                {n.setting_ref && n.setting_ref !== '无' && <p className="text-text-placeholder text-xxs">👤 {n.setting_ref}</p>}
              </div>
            ))}
          </div>
        ) : null}
        {vol.cool_density && <p>⭐ {vol.cool_density}</p>}
        {vol.golden_five && <p>🥇 {vol.golden_five}</p>}
        {vol.character_milestones?.length ? (
          <div>
            <p className="font-medium mt-1 mb-0.5">👤 人物里程碑</p>
            {vol.character_milestones.map((cm, i) => (
              <p key={i}>{cm.character}: {cm.start_state} → {cm.end_state}（{cm.key_event}）</p>
            ))}
          </div>
        ) : null}
        {vol.conflict_nodes?.length ? (
          <div>
            <p className="font-medium mt-1 mb-0.5">⚔️ 冲突节点</p>
            {vol.conflict_nodes.map((cn, i) => (
              <p key={i}>[{cn.chapter_segment}] {cn.description}（{cn.escalation_type}）</p>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  )
}
