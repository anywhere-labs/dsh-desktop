/** The Profiles & data tab of the Desktop settings page. */

import type { DesktopProfileView } from '../../../../dsh-plugin-desktop/src/client/desktop-settings-api.ts'
import type { Translate } from './model.ts'
import type { DesktopSettingsModel } from './use-desktop-settings-section.ts'
import { Choice } from './controls.tsx'
import { MARKET_OPTIONS, marketBody, marketTitle } from './market-options.tsx'

function profileState(profile: DesktopProfileView, t: Translate): string {
  if (!profile.exists || !profile.webCapable || !profile.selectable) return t('profileUnavailable')
  return t('profileReady')
}

/** The Profiles & data tab: Profiles, the plugin market and Agents Anywhere. */
export function DesktopSettingsProfilesTab({ model }: { model: DesktopSettingsModel }) {
  const {
    t, capabilities, tabSections, view, profileName, setProfileName, busy, loadFailed, aaStatus, restart,
    pendingProfileDelete, setPendingProfileDelete, load, profileBusy, createProfile, selectProfile, deleteProfile,
    selectAa, selectMarket,
  } = model
  return (
    <>
      <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-profile-title">
        <div>
          <h3 id="dsh-desktop-profile-title">{t('profileTitle')}</h3>
          <p className="dshDesktopSettingsGroupIntro">{t('profileIntro')}</p>
        </div>
        {busy === 'load' && view === undefined && <p className="dshDesktopSettingsHint">{t('loading')}</p>}
        {loadFailed && view === undefined && (
          <div>
            <p className="dshDesktopSettingsError" role="alert">{t('unavailable')}</p>
            <button type="button" className="dshDesktopSettingsButton" onClick={() => { void load() }}>{t('retry')}</button>
          </div>
        )}
        {view !== undefined && (
          <>
            <div className="dshDesktopSettingsList" role="radiogroup" aria-labelledby="dsh-desktop-profile-title">
              {view.profiles.map((profile) => {
                const current = profile.name === view.current
                const deleteAction = profile.deletable && !current && restart === 'none'
                  ? (
                    <div className="dshDesktopSettingsChoiceAside" onClick={event => { event.stopPropagation() }}>
                      {pendingProfileDelete === profile.name ? (
                        <div className="dshDesktopSettingsDeleteConfirm" role="group" aria-label={t('confirmDeleteProfile')}>
                          <span className="dshDesktopSettingsDeleteWarning">{t('deleteProfileWarning')}</span>
                          <span className="dshDesktopSettingsDeleteActions">
                            <button
                              type="button"
                              className="dshDesktopSettingsButton dshDesktopSettingsButtonDanger"
                              disabled={profileBusy}
                              onClick={() => { deleteProfile(profile.name) }}
                            >
                              {busy === 'delete-profile' ? t('deletingProfile') : t('confirmDeleteProfile')}
                            </button>
                            <button
                              type="button"
                              className="dshDesktopSettingsButton dshDesktopSettingsButtonSecondary"
                              disabled={profileBusy}
                              onClick={() => { setPendingProfileDelete(undefined) }}
                            >
                              {t('cancelDeleteProfile')}
                            </button>
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="dshDesktopSettingsButton dshDesktopSettingsButtonSecondary"
                          disabled={profileBusy}
                          onClick={() => { setPendingProfileDelete(profile.name) }}
                        >
                          {t('deleteProfile')}
                        </button>
                      )}
                    </div>
                  ) : undefined
                return (
                  <Choice
                    key={profile.name}
                    title={profile.name}
                    body={profileState(profile, t)}
                    selected={current}
                    disabled={!profile.selectable || profileBusy || restart !== 'none'}
                    action={() => { selectProfile(profile.name) }}
                    status={current ? t('activeProfile') : undefined}
                    aside={deleteAction}
                  />
                )
              })}
            </div>
            <form className="dshDesktopSettingsForm" onSubmit={createProfile}>
              <label className="dshDesktopSettingsField">
                {t('profileName')}
                <input
                  className="dshDesktopSettingsInput"
                  value={profileName}
                  maxLength={128}
                  autoComplete="off"
                  placeholder={t('profileNamePlaceholder')}
                  disabled={profileBusy || restart !== 'none'}
                  onChange={event => { setProfileName(event.currentTarget.value) }}
                />
              </label>
              <button
                type="submit"
                className="dshDesktopSettingsButton"
                disabled={profileName.trim().length === 0 || profileBusy || restart !== 'none'}
              >
                {busy === 'create-profile' ? t('creatingProfile') : t('create')}
              </button>
            </form>
          </>
        )}
      </section>

      {capabilities?.pluginSelectors !== false && <>
      <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-market-title">
        <div>
          <h3 id="dsh-desktop-market-title">{t('marketTitle')}</h3>
          <p className="dshDesktopSettingsGroupIntro">{t('marketIntro')}</p>
        </div>
        {view?.market.legacyDefaulted === true && <p className="dshDesktopSettingsNotice">{t('legacyMarketNotice')}</p>}
        {view !== undefined && view.market.requested !== view.market.effective && restart === 'none' && (
          <p className="dshDesktopSettingsNotice" role="status">{t('marketLoadFailed')}</p>
        )}
        {view !== undefined && (
          <div className="dshDesktopSettingsList" role="radiogroup" aria-labelledby="dsh-desktop-market-title">
            {MARKET_OPTIONS.filter(option => capabilities?.markets === undefined || capabilities.markets.includes(option.id)).map(option => (
              <Choice
                key={option.id}
                title={marketTitle(option, t)}
                badge={option.id === 'community-market' ? t('beta') : undefined}
                body={marketBody(option, t)}
                selected={view.market.requested === option.id}
                reselectable={view.market.requested === option.id && view.market.requested !== view.market.effective}
                disabled={capabilities?.featuresReadOnly === true || busy !== undefined || restart !== 'none'}
                action={() => { selectMarket(option.id) }}
                status={view.market.requested === option.id && view.market.requested !== view.market.effective
                    ? t('retryMarket')
                    : view.market.requested === option.id ? t('selected') : undefined}
              />
            ))}
          </div>
        )}
      </section>

      <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-aa-title">
        <div>
          <h3 id="dsh-desktop-aa-title">{t('aaTitle')}</h3>
          <p className="dshDesktopSettingsGroupIntro">{t('aaIntro')}</p>
        </div>
        {view?.aa?.requested === true && !view.aa.effective && restart === 'none' && (
          <p className="dshDesktopSettingsNotice" role="status">{t('aaLoadFailed')}</p>
        )}
        {aaStatus === 'saving' && <p className="dshDesktopSettingsNotice" role="status">{t('aaSaving')}</p>}
        {aaStatus === 'failed' && <p className="dshDesktopSettingsError" role="alert">{t('aaSaveFailed')}</p>}
        {aaStatus === 'saved' && <p className="dshDesktopSettingsSuccess" role="status">
          {t(restart === 'restarting' ? 'restarting' : restart === 'required' ? 'restartRequired' : 'aaSaved')}
        </p>}
        {view !== undefined && <div className="dshDesktopSettingsList" role="radiogroup" aria-labelledby="dsh-desktop-aa-title">
          {[false, true].map(enabled => <Choice
            key={String(enabled)}
            title={t(enabled ? 'aaEnabled' : 'aaDisabled')}
            badge={enabled ? t('beta') : undefined}
            body={t(enabled ? 'aaEnabledBody' : 'aaDisabledBody')}
            selected={(view.aa?.requested ?? false) === enabled}
            reselectable={enabled && view.aa?.requested === true && !view.aa.effective}
            disabled={capabilities?.featuresReadOnly === true || busy !== undefined || restart !== 'none'}
            action={() => { selectAa(enabled) }}
            status={enabled && view.aa?.requested === true && !view.aa.effective
              ? t('retryAa') : (view.aa?.requested ?? false) === enabled ? t('selected') : undefined}
          />)}
        </div>}
      </section>

      </>}

      {tabSections?.profiles}
    </>
  )
}
