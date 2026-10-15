import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** 用户在场景页输入框提交的场景名，如「坐飞机」「点咖啡」 */
export class CreateSceneDto {
  @IsString()
  @IsNotEmpty({ message: '场景名称不能为空' })
  @MaxLength(20, { message: '场景名称最多 20 个字' })
  name: string;
}
