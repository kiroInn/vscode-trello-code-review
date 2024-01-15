import * as vscode from 'vscode';
import axios from 'axios';

import { encrypt, decrypt, getCurrentDate, getNextDate } from '../common/utils';
import { TrelloBoard, TrelloList } from '.';
import { API_BASE_URL, GLOBAL_STATE } from './constants';
import { trelloApiGetRequest, trelloApiPostRequest } from './api';

export class TrelloActions {
  private globalState: any;
  private API_KEY: string | undefined;
  private API_TOKEN: string | undefined;
  private BOARD_ID: string | undefined;

  constructor(context?: vscode.ExtensionContext) {
    this.globalState = context ? context.globalState : {};
    axios.defaults.baseURL = API_BASE_URL;

    this.getCredentials();
  }

  getCredentials(): void {
    try {
      this.API_KEY = this.globalState.get(GLOBAL_STATE.API_KEY);
      this.API_TOKEN = decrypt(this.globalState.get(GLOBAL_STATE.API_TOKEN));
      this.BOARD_ID = this.globalState.get(GLOBAL_STATE.BOARD_ID);
    } catch (error) {
      console.error(error);
      vscode.window.showErrorMessage('Error getting credentials');
    }
  }

  setTrelloCredential(
    isPassword: boolean,
    placeHolderText: string
  ): Thenable<string | undefined> {
    return vscode.window.showInputBox({
      ignoreFocusOut: true,
      password: isPassword,
      placeHolder: placeHolderText,
    });
  }

  async setCredentials(): Promise<void> {
    try {
      const apiKey = await this.setTrelloCredential(
        false,
        'Your Trello API key'
      );
      const apiToken = await this.setTrelloCredential(
        true,
        'Your Trello API token'
      );
      if (apiKey !== undefined) {
        this.globalState.update(GLOBAL_STATE.API_KEY, apiKey);
      }
      if (apiToken !== undefined) {
        this.globalState.update(GLOBAL_STATE.API_TOKEN, encrypt(apiToken));
      }
      this.getCredentials();
    } catch (error) {
      console.error(error);
      vscode.window.showErrorMessage('Error while setting credentials');
    }
  }

  async fetchApiToken(apiKey: string): Promise<void> {
    const apiTokenUrl = `https://trello.com/1/authorize?expiration=never&name=VS%20Code%20Trello%20Code%20Review&scope=read,write,account&response_type=token&key=${apiKey}`;
    try {
      vscode.commands.executeCommand(
        'vscode.open',
        vscode.Uri.parse(apiTokenUrl)
      );
      const apiToken = await this.setTrelloCredential(
        true,
        'Your Trello API token'
      );
      if (apiToken !== undefined) {
        this.globalState.update(GLOBAL_STATE.API_TOKEN, encrypt(apiToken));
      }
      vscode.window.showInformationMessage('Success');
    } catch (error) {
      console.error(error);
      vscode.window.showErrorMessage('Error fetching API token');
    }
  }

  async authenticate(): Promise<void> {
    try {
      const apiKey = await this.setTrelloCredential(
        false,
        'Your Trello API key'
      );
      if (apiKey !== undefined) {
        this.globalState.update(GLOBAL_STATE.API_KEY, apiKey);
        await this.fetchApiToken(apiKey);
        this.getCredentials();
        await this.updateBoardId();
      } else {
        const appKeyUrl = await vscode.window.showInformationMessage(
          'Get your Trello API key here:',
          'https://trello.com/app-key'
        );
        if (appKeyUrl) {
          vscode.commands.executeCommand(
            'vscode.open',
            vscode.Uri.parse(appKeyUrl)
          );
        }
      }
    } catch (error) {
      console.error(error);
      vscode.window.showErrorMessage('Error during authentication');
    }
  }
  async updateBoardId(): Promise<void> {
    try {
      const url = await vscode.window.showInputBox({
        ignoreFocusOut: true,
        password: false,
        placeHolder: 'Your Trello Board Url',
      });
      if (url !== undefined) {
        const parsedURL = new URL(url);
        const pathname = parsedURL.pathname;
        const matchRes = pathname.match(/\/b\/(\w+)\//);
        if (matchRes) {
          const boardShortLink = matchRes[1];
          const boards = await this.getBoards();
          const board = boards.find(
            (board) => board.shortLink === boardShortLink
          );
          if (board) {
            this.BOARD_ID = board.id;
            this.globalState.update(GLOBAL_STATE.BOARD_ID, board.id);
            vscode.window.showInformationMessage('Success');
          } else {
            vscode.window.showErrorMessage('Error Trello Board Url is invalid');
          }
        } else {
          vscode.window.showErrorMessage('Error Trello Board Url is invalid');
        }
      }
    } catch (error) {
      console.error(error);
      vscode.window.showErrorMessage('Error fetching API token');
    }
  }

  async showSuccessMessage(msg: string, url?: string) {
    let cardUrl;
    if (url) {
      cardUrl = await vscode.window.showInformationMessage(msg, url);
      if (cardUrl) {
        vscode.commands.executeCommand(
          'vscode.open',
          vscode.Uri.parse(cardUrl)
        );
      }
    } else {
      vscode.window.showInformationMessage(msg);
    }
  }

  getBoards(starredBoards?: boolean): Promise<TrelloBoard[]> {
    const res = trelloApiGetRequest('/1/members/me/boards', {
      filter: starredBoards ? 'starred' : 'all',
      key: this.API_KEY,
      token: this.API_TOKEN,
    });
    return res;
  }

  getChecklistsFromBoard(boardId: string): Promise<TrelloList[]> {
    const res = trelloApiGetRequest(`/1/boards/${boardId}/lists`, {
      key: this.API_KEY,
      token: this.API_TOKEN,
    });
    return res;
  }

  async addCard(): Promise<void> {
    const boardId = this.BOARD_ID;
    if (!boardId) {
      vscode.window.showErrorMessage(
        'Error Trello Board Url is invalid, Please authenticate'
      );
      return;
    }
    const cardName = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      placeHolder: 'Enter name of card',
    });
    if (cardName === undefined) {
      return;
    }
    const roleAuth = { key: this.API_KEY, token: this.API_TOKEN };
    const checklists = await this.getChecklistsFromBoard(boardId);
    const currentDate = getCurrentDate();
    const checklist = checklists.find((cl) => cl.name === currentDate);
    const { id: userId } = await trelloApiGetRequest(`/1/members/me`, roleAuth);

    const basePayload = {
      ...roleAuth,
      name: cardName,
      idMembers: [userId],
      due: getNextDate(),
      desc: this.getCardDesc(),
    };

    if (!!checklist) {
      const createdCard = await trelloApiPostRequest('/1/cards', {
        ...basePayload,
        idList: checklist.id,
      });
      if (!createdCard) {
        return;
      }
      this.showSuccessMessage(
        `Created Card: ${createdCard.idShort}-${createdCard.name}`,
        createdCard.shortUrl
      );
      return;
    } else {
      const createdChecklist = await trelloApiPostRequest('/1/lists', {
        ...roleAuth,
        idBoard: boardId,
        name: currentDate,
      });
      if (createdChecklist) {
        const createdCard = await trelloApiPostRequest('/1/cards', {
          ...basePayload,
          idList: createdChecklist.id,
        });
        if (!createdCard) {
          return;
        }
        this.showSuccessMessage(
          `Created Card: ${createdCard.idShort}-${createdCard.name}`,
          createdCard.shortUrl
        );
      }
      return;
    }
  }

  getCardDesc() {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const fileUri = editor.document.uri;
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
      if (workspaceFolder) {
        const relativePath = vscode.workspace.asRelativePath(fileUri);
        const lineNumber = editor.selection.active.line + 1;
        return `${workspaceFolder.name} ${relativePath} ${lineNumber}`;
      } else {
        vscode.window.showInformationMessage('No workspace folder found.');
      }
    }
    return ``;
  }
}
