import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsNotEmpty,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class VocabItemDto {
  @IsString()
  word: string;

  @IsOptional()
  @IsString()
  phonetic?: string;

  @IsOptional()
  @IsString()
  pos?: string;

  @IsOptional()
  @IsString()
  meaning?: string;
}

class PatternItemDto {
  @IsString()
  pattern: string;

  @IsOptional()
  @IsString()
  explanation?: string;

  @IsOptional()
  @IsString()
  example?: string;
}

export class CreateFavoriteDto {
  @IsString()
  @IsNotEmpty({ message: 'sourceText 不能为空' })
  @MaxLength(500)
  sourceText: string;

  @IsString()
  @IsNotEmpty({ message: 'translation 不能为空' })
  @MaxLength(1000)
  translation: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VocabItemDto)
  vocabulary?: VocabItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PatternItemDto)
  patterns?: PatternItemDto[];

  @IsOptional()
  @IsIn(['translation', 'scene_word', 'scene_expression'])
  sourceType?: string;

  @IsOptional()
  @IsString()
  sceneKey?: string;

  @IsOptional()
  @IsString()
  sceneName?: string;
}
